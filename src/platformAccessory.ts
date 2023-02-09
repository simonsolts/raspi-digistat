import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { syncBuiltinESMExports } from 'module';

import { DigistatPlatform } from './platform';
const { execSync } = require("child_process");



/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class DigistatAccessory {
  private service: Service;

  public BLUETOOTH_MAX_RETRIES = 10; // Number of times to retry, may need adjusting based on your system's bluetooth performance
  public BLUETOOTH_DEFAULT_RETRY_WAIT = 750; // In milliseconds (0.75 seconds)
  public BLUETOOTH_RETRY_WAIT_INCREMENT = 500; // In milliseconds, * number of retries, plus initial wait (0.75, 1.25, 1.75, 2.25, 2.75)
  public BLUETOOTH_COMMAND_TIMEOUT = 10000; // Node process timeout (10 seconds)
  public pollTimeInMinutes = 15; // In minutes
  public pollTimeInMilliseconds = this.pollTimeInMinutes * 60000;
  public pollTimeInSeconds = this.pollTimeInMinutes * 60;
  public state = {
    targetTemp: 10,
    currentTemp: 17,
    lastUpdatedCurrentTemp: new Date(),
    targetHeatingState: this.platform.Characteristic.TargetHeatingCoolingState.OFF,
    heatingState: this.platform.Characteristic.CurrentHeatingCoolingState.OFF,
    temperatureDisplayUnits: this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS,
  }

  constructor(
    private readonly platform: DigistatPlatform,
    private readonly accessory: PlatformAccessory,
  ) {

    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Drayton Wiser')
      .setCharacteristic(this.platform.Characteristic.Model, 'Digistat')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.accessory.context.device.macAddress);

    this.service = this.accessory.getService(this.platform.Service.Thermostat) || this.accessory.addService(this.platform.Service.Thermostat);

    // set the service name, this is what is displayed as the default name on the Home app
    // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
    this.service.setCharacteristic(this.platform.Characteristic.Name, this.accessory.context.device.displayName);

    // each service must implement at-minimum the "required characteristics" for the given service type
    // see https://developers.homebridge.io/#/service/Lightbulb

    this.service.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState)
      .onGet(this.handleCurrentHeatingCoolingStateGet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
      .onGet(this.handleTargetHeatingCoolingStateGet.bind(this))
      .onSet(this.handleTargetHeatingCoolingStateSet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(this.handleCurrentTemperatureGet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .onGet(this.handleTargetTemperatureGet.bind(this))
      .onSet(this.handleTargetTemperatureSet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits)
      .onGet(this.handleTemperatureDisplayUnitsGet.bind(this))
      .onSet(this.handleTemperatureDisplayUnitsSet.bind(this));
    
    this.getCurrentTemperaturePoll(true); // Get the current temperature on startup
    this.setHeatingState(this.platform.Characteristic.CurrentHeatingCoolingState.OFF); // Set the heating state to off on startup
    setInterval(async () =>{await this.getCurrentTemperaturePoll()}, this.pollTimeInMilliseconds);
  }


  /**
   * Handle requests to get the current value of the "Current Heating Cooling State" characteristic
   */
  async handleCurrentHeatingCoolingStateGet() {
    this.platform.log.debug('Triggered GET TargetHeatingCoolingState');
    if(this.state.heatingState == (this.platform.Characteristic.CurrentHeatingCoolingState.HEAT || this.platform.Characteristic.CurrentHeatingCoolingState.OFF)) {
      return this.state.heatingState;
    } else {
      if(this.state.targetTemp >= this.state.currentTemp) {
        return this.platform.Characteristic.CurrentHeatingCoolingState.HEAT;
      } else {
        return this.platform.Characteristic.CurrentHeatingCoolingState.OFF;
      }
    }
  }


  /**
   * Handle requests to get the current value of the "Target Heating Cooling State" characteristic
   */
  async handleTargetHeatingCoolingStateGet() {
    this.platform.log.debug('Triggered GET TargetHeatingCoolingState');
    if(this.state.heatingState == (this.platform.Characteristic.CurrentHeatingCoolingState.HEAT || this.platform.Characteristic.CurrentHeatingCoolingState.OFF)) {
      return this.state.heatingState;
    } else {
      if(this.state.targetTemp >= this.state.currentTemp) {
        return this.platform.Characteristic.CurrentHeatingCoolingState.HEAT;
      } else {
        return this.platform.Characteristic.CurrentHeatingCoolingState.OFF;
      }
    }
  }

  /**
   * Handle requests to set the "Target Heating Cooling State" characteristic
   */
  async handleTargetHeatingCoolingStateSet(value) {
    if(value == this.platform.Characteristic.TargetHeatingCoolingState.OFF || value == this.platform.Characteristic.TargetHeatingCoolingState.COOL) {
      this.state.targetTemp = 16;
      this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature).setValue(this.state.targetTemp);
    } else {
      let currentTemp = this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature).value;
      this.state.targetTemp = Number(currentTemp) + 1.5;
      if (this.state.targetTemp <= 24) {
        this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature).setValue(this.state.targetTemp);
      } 
    }

    this.platform.log.debug('Triggered SET TargetHeatingCoolingState ' + value);
  }

  setHeatingState(value) {
    this.state.heatingState = value;
    this.service.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState).updateValue(value);
  }


  /**
   * Handle requests to get the current value of the "Current Temperature" characteristic
   */
  async handleCurrentTemperatureGet() {
    const now = new Date(); 
    if ((now.getTime() - this.state.lastUpdatedCurrentTemp.getTime()) < (this.pollTimeInSeconds)) {
      return this.state.currentTemp;
    } else {
      var command = `gatttool --sec-level=high --device=${this.accessory.context.device.macAddress} --char-read --handle='0x000f'`
      var success = false;
      var retryCounter = 0;
      var temperature = 0;
      do {
        if(retryCounter > 0) {
            // Bluetooth is flaky, so we need to wait a bit before retrying
            // The delay is a random number between 0 and 2.5 times the retry wait incrementc to avoid multiple devices all retrying at the same time
            let delay = Math.round(this.BLUETOOTH_DEFAULT_RETRY_WAIT + 
              (retryCounter * 
                (Math.random() * 
                  (this.BLUETOOTH_RETRY_WAIT_INCREMENT*2.5 - this.BLUETOOTH_RETRY_WAIT_INCREMENT) + this.BLUETOOTH_RETRY_WAIT_INCREMENT
                )
              ));
            this.platform.log.debug('Get Current Temperature Failed: Retrying in ' + Math.round(delay/1000) + ' seconds');
            await new Promise(resolve => setTimeout(resolve, Math.round(delay)));
        };
        try {
          let output = execSync(command, {timeout: this.BLUETOOTH_COMMAND_TIMEOUT});
          if (output.toString().includes('Characteristic value/descriptor')) {
            temperature = this.temperatureOutputToValue(output);
            if(temperature) {
              this.state.currentTemp = temperature;
              success = true
            }
          } else {
            this.platform.log.debug('Get Current Temperature Failed: ');
          }
        } catch (e) {
          this.platform.log.debug('Get Current Temperature Failed: ' + e);
        }
        retryCounter++;
      } while (!success || retryCounter > this.BLUETOOTH_MAX_RETRIES);
      try {
        this.state.currentTemp = temperature;
        this.state.lastUpdatedCurrentTemp = new Date();
        this.platform.log.info(`Current Temperature in: ${this.accessory.context.device.displayName} is ${this.state.currentTemp}`);
        return this.state.currentTemp;
      } catch (e) {
        this.platform.log.warn('Get Current Temperature Failed, using stale temperature: ' + e);
        return this.state.currentTemp;
      }
      return this.state.currentTemp;
    }
  }

    /**
   * Handle requests to get the current value of the "Current Temperature" characteristic, used to poll so it's always up to date
   */
    async getCurrentTemperaturePoll(forceImmediatePoll=false) {
      const now = new Date(); 
      if (!forceImmediatePoll && (now.getTime() - this.state.lastUpdatedCurrentTemp.getTime()) < (this.pollTimeInSeconds)) {
        this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature).updateValue(this.state.currentTemp);
      } else {
        var command = `gatttool --sec-level=high --device=${this.accessory.context.device.macAddress} --char-read --handle='0x000f'`
        var success = false;
        var retryCounter = 0;
        var temperature = 0;
        do {
          if(retryCounter > 0) {
            // Bluetooth is flaky, so we need to wait a bit before retrying
            // The delay is a random number between 0 and 2.5 times the retry wait incrementc to avoid multiple devices all retrying at the same time
            let delay = Math.round(this.BLUETOOTH_DEFAULT_RETRY_WAIT + 
                        (retryCounter * 
                          (Math.random() * 
                            (this.BLUETOOTH_RETRY_WAIT_INCREMENT*2.5 - this.BLUETOOTH_RETRY_WAIT_INCREMENT) + this.BLUETOOTH_RETRY_WAIT_INCREMENT
                          )
                        ));
            this.platform.log.debug('Get Current Temperature Failed: Retrying in ' + Math.round(delay/1000) + ' seconds');
            await new Promise(resolve => setTimeout(resolve, Math.round(delay)));
          };
          try {
            let output = execSync(command, {timeout: this.BLUETOOTH_COMMAND_TIMEOUT});
            if (output.toString().includes('Characteristic value/descriptor')) {
              temperature = this.temperatureOutputToValue(output);
              if(temperature && temperature != 0) {
                this.state.currentTemp = temperature;
                success = true
              }
            } else {
              this.platform.log.debug('Get TargetTemperature Failed: ');
            }
          } catch (e) {
            this.platform.log.debug('Get TargetTemperature Failed: ' + e);
          }
          retryCounter++;
        } while (!success || retryCounter > this.BLUETOOTH_MAX_RETRIES);
        try {
          this.state.currentTemp = temperature;
          this.state.lastUpdatedCurrentTemp = new Date();
          this.platform.log.info(`Current Temperature in: ${this.accessory.context.device.displayName} is ${this.state.currentTemp}`);
          this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature).updateValue(this.state.currentTemp);
        } catch (e) {
          this.platform.log.debug('Get Current Temperature Failed, using stale temperature: ' + e);
        }
      }
    }



  /**
   * Handle requests to get the current value of the "Target Temperature" characteristic
   */
  handleTargetTemperatureGet() {
    this.platform.log.debug('Triggered GET TargetTemperature');
    if (this.state.targetTemp <= 14) {
      this.setHeatingState(this.platform.Characteristic.CurrentHeatingCoolingState.OFF);
      this.state.targetTemp = 14;
      return 14
    } else if (this.state.targetTemp > this.state.currentTemp) {
      this.setHeatingState(this.platform.Characteristic.CurrentHeatingCoolingState.HEAT);
      return this.state.targetTemp;
    } else if (this.state.targetTemp <= this.state.currentTemp) {
      this.setHeatingState(this.platform.Characteristic.CurrentHeatingCoolingState.OFF);
      if(this.state.targetTemp < 14) {return 14} else {return this.state.targetTemp}
    }
    return this.state.targetTemp
  }

  /**
   * Handle requests to set the "Target Temperature" characteristic
   */
  async handleTargetTemperatureSet(value) {
    const temperatureAsHex = this.temperatureToHex(value);
    var command = `gatttool --sec-level=high --device=${this.accessory.context.device.macAddress} --char-write-req --handle='0x0008' --value='000009ff10c001000102${temperatureAsHex}00'`
    var success = false;
    var retryCounter = 0;
    do {
      if(retryCounter > 0) {
          // Bluetooth is flaky, so we need to wait a bit before retrying
          // The delay is a random number between 0 and 2.5 times the retry wait incrementc to avoid multiple devices all retrying at the same time
          let delay = Math.round(this.BLUETOOTH_DEFAULT_RETRY_WAIT + 
            (retryCounter * 
              (Math.random() * 
                (this.BLUETOOTH_RETRY_WAIT_INCREMENT*2.5 - this.BLUETOOTH_RETRY_WAIT_INCREMENT) + this.BLUETOOTH_RETRY_WAIT_INCREMENT
              )
            ));
          this.platform.log.debug(`Setting Temperature in ${this.accessory.context.device.displayName} to ${value} Failed: Retrying in ` + Math.round(delay/1000) + ' seconds');
          await new Promise(resolve => setTimeout(resolve, Math.round(delay)));
      };
      try {
        let output = execSync(command, {timeout: this.BLUETOOTH_COMMAND_TIMEOUT});
        if (output.toString().includes('Characteristic value was written successfully')) {
            success = true
            this.state.targetTemp = value;
            this.platform.log.info(`Setting Temperature in: ${this.accessory.context.device.displayName} to ${this.state.currentTemp}`)
        } else {
          this.platform.log.debug(`Setting Temperature in ${this.accessory.context.device.displayName} to ${value} Failed:`);
        }
      } catch (e) {
        this.platform.log.debug(`Setting Temperature in ${this.accessory.context.device.displayName} to ${value} Failed:` + e);
      }
      retryCounter++;
    } while (!success || (retryCounter > this.BLUETOOTH_MAX_RETRIES));
    if(!success) {
      this.platform.log.debug(`Setting Temperature in ${this.accessory.context.device.displayName} to ${value} Failed`);
    }
  }

  /**
   * Handle requests to get the current value of the "Temperature Display Units" characteristic
   */
  handleTemperatureDisplayUnitsGet() {
    this.platform.log.debug('Triggered GET TemperatureDisplayUnits');

    // set this to a valid value for TemperatureDisplayUnits
    const currentValue = this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS;

    return currentValue;
  }

  /**
   * Handle requests to set the "Temperature Display Units" characteristic
   */
  handleTemperatureDisplayUnitsSet(value) {
    if(value == this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS || this.platform.Characteristic.TemperatureDisplayUnits.FAHRENHEIT) {
      this.state.temperatureDisplayUnits = value;
    } else {
      this.platform.log.debug('Triggered SET TemperatureDisplayUnits: ' + value + ' is not a valid value, usign CELSIUS');
      this.state.temperatureDisplayUnits = this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS;
    }
  }

  temperatureToHex(temperature: number) {
    const rounded = Math.ceil(temperature/5)*5;
    const hex = Number(temperature*10).toString(16);
    return hex;
  }

  temperatureOutputToValue(output: Buffer) :number {
    const stringArray = output.toString().split(' ');
    const temperature = parseInt(stringArray[10] ?? '0', 16);
    if(temperature <= 100){ 
      return 0;
    } else {
      return temperature / 10;
    }
  }

  async sleep(seconds) {
    return new Promise((resolve) => {
      setTimeout(resolve, seconds * 1000);
    });
  }

}
