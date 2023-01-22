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

  /**
   * These are just used to create a working example
   * You should implement your own code to track the state of your accessory
   */
  private exampleStates = {
    On: false,
    Brightness: 100,
  };

  private state = {
    targetTemp: 17,
    currentTemp: 17,
    lastUpdatedCurrentTemp: new Date(),
  }

  constructor(
    private readonly platform: DigistatPlatform,
    private readonly accessory: PlatformAccessory,
  ) {

    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Drayton Wiser')
      .setCharacteristic(this.platform.Characteristic.Model, 'Digistat')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, '0C:43:14:2F:3B:5F');

    this.service = this.accessory.getService(this.platform.Service.Thermostat) || this.accessory.addService(this.platform.Service.Thermostat);

    // set the service name, this is what is displayed as the default name on the Home app
    // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.displayName);

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


    /**
     * Creating multiple services of the same type.
     *
     * To avoid "Cannot add a Service with the same UUID another Service without also defining a unique 'subtype' property." error,
     * when creating multiple services of the same type, you need to use the following syntax to specify a name and subtype id:
     * this.accessory.getService('NAME') || this.accessory.addService(this.platform.Service.Lightbulb, 'NAME', 'USER_DEFINED_SUBTYPE_ID');
     *
     * The USER_DEFINED_SUBTYPE must be unique to the platform accessory (if you platform exposes multiple accessories, each accessory
     * can use the same sub type id.)
     */

    // // Example: add two "motion sensor" services to the accessory
    // const motionSensorOneService = this.accessory.getService('Motion Sensor One Name') ||
    //   this.accessory.addService(this.platform.Service.MotionSensor, 'Motion Sensor One Name', 'YourUniqueIdentifier-1');

    // const motionSensorTwoService = this.accessory.getService('Motion Sensor Two Name') ||
    //   this.accessory.addService(this.platform.Service.MotionSensor, 'Motion Sensor Two Name', 'YourUniqueIdentifier-2');

    // /**
    //  * Updating characteristics values asynchronously.
    //  *
    //  * Example showing how to update the state of a Characteristic asynchronously instead
    //  * of using the `on('get')` handlers.
    //  * Here we change update the motion sensor trigger states on and off every 10 seconds
    //  * the `updateCharacteristic` method.
    //  *
    //  */
    // let motionDetected = false;
    // setInterval(() => {
    //   // EXAMPLE - inverse the trigger
    //   motionDetected = !motionDetected;

    //   // push the new value to HomeKit
    //   motionSensorOneService.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, motionDetected);
    //   motionSensorTwoService.updateCharacteristic(this.platform.Characteristic.MotionDetected, !motionDetected);
    //   this.handleCurrentTemperatureGet.bind(this)
    //   this.platform.log.debug('Triggering motionSensorOneService:', motionDetected);
    //   this.platform.log.debug('Triggering motionSensorTwoService:', !motionDetected);
    // }, 600000);
  }


  /**
   * Handle requests to get the current value of the "Current Heating Cooling State" characteristic
   */
  async handleCurrentHeatingCoolingStateGet() {
    this.platform.log.debug('Triggered GET CurrentHeatingCoolingState');

    // set this to a valid value for CurrentHeatingCoolingState
    const currentValue = this.platform.Characteristic.CurrentHeatingCoolingState.HEAT;

    return currentValue;
  }


  /**
   * Handle requests to get the current value of the "Target Heating Cooling State" characteristic
   */
  async handleTargetHeatingCoolingStateGet() {
    this.platform.log.debug('Triggered GET TargetHeatingCoolingState');

    if(this.state.targetTemp >= this.state.currentTemp) {
      return this.platform.Characteristic.TargetHeatingCoolingState.HEAT;
    } else {
      return this.platform.Characteristic.TargetHeatingCoolingState.OFF;
    }
  }

  /**
   * Handle requests to set the "Target Heating Cooling State" characteristic
   */
  handleTargetHeatingCoolingStateSet(value) {
    this.platform.log.debug('Triggered SET TargetHeatingCoolingState:' + value);
  }

  /**
   * Handle requests to get the current value of the "Current Temperature" characteristic
   */
  async handleCurrentTemperatureGet() {
    const now = new Date(); 
    if ((now.getTime() - this.state.lastUpdatedCurrentTemp.getTime()) / 1000 < 5 * 60) {
      return this.state.currentTemp;
    } else {
      let command = `gatttool --sec-level=high --device=0C:43:14:2F:3B:5F --char-read --handle='0x000f'`
      let success = false;
      let retryCounter = 0;
      let temperature;
      do {
        if(retryCounter > 0) {await this.sleep(10)};
        try {
          let output = execSync(command);
          if (output.toString().includes('Characteristic value/descriptor')) {
            temperature = this.temperatureOutputToValue(output);
            if(temperature) {
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
      } while (!success && retryCounter++ < 3);
      this.state.currentTemp = temperature ?? 17;
      this.state.lastUpdatedCurrentTemp = new Date();
      return temperature;
    }
  }


  /**
   * Handle requests to get the current value of the "Target Temperature" characteristic
   */
  handleTargetTemperatureGet() {
    this.platform.log.debug('Triggered GET TargetTemperature');

    return this.state.targetTemp;
  }

  /**
   * Handle requests to set the "Target Temperature" characteristic
   */
  async handleTargetTemperatureSet(value) {
    this.platform.log.debug('Triggered SET TargetTemperature: ' + value);
    let temperatureAsHex = this.temperatureToHex(value);
    let command = `gatttool --sec-level=high --device=0C:43:14:2F:3B:5F --char-write-req --handle='0x0008' --value='000009ff10c001000102${temperatureAsHex}00'`
    let success = false;
    try {
      let output = execSync(command);
      if (output.includes('Characteristic value was written successfully')) {
        this.platform.log.info('Set TargetTemperature Success: ' + value);
        success = true
      } else {
        this.platform.log.debug('Set TargetTemperature Failed: ' + value);
      }
    } catch (e) {
      this.platform.log.debug('Set TargetTemperature Failed: ' + e);
    }
    if(!success) {
      await this.sleep(10);
      execSync(command);
    }
    this.state.targetTemp = value;
    return value
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
    this.platform.log.debug('Triggered SET TemperatureDisplayUnits: ' + value);
  }

  temperatureToHex(temperature: number) {
    const rounded = Math.ceil(temperature/5)*5;
    const hex = Number(temperature*10).toString(16);
    return hex;
  }

  temperatureOutputToValue(output: string) {
    const stringArray = output.toString().split(' ');
    let temperature = parseInt(stringArray[10]);
    if(temperature == 0){ 
      return false;
    } else {
      return temperature / 10;
    }
  }

  sleep(seconds) {
    return new Promise((resolve) => {
      setTimeout(resolve, seconds * 1000);
    });
  }









  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, turning on a Light bulb.
   */
  async setOn(value: CharacteristicValue) {
    // implement your own code to turn your device on/off
    this.exampleStates.On = value as boolean;
    
    this.platform.log.debug('Set Characteristic On ->', value);
  }

  /**
   * Handle the "GET" requests from HomeKit
   * These are sent when HomeKit wants to know the current state of the accessory, for example, checking if a Light bulb is on.
   *
   * GET requests should return as fast as possbile. A long delay here will result in
   * HomeKit being unresponsive and a bad user experience in general.
   *
   * If your device takes time to respond you should update the status of your device
   * asynchronously instead using the `updateCharacteristic` method instead.

   * @example
   * this.service.updateCharacteristic(this.platform.Characteristic.On, true)
   */
  async getOn(): Promise<CharacteristicValue> {
    // implement your own code to check if the device is on
    const isOn = this.exampleStates.On;

    this.platform.log.debug('Get Characteristic On ->', isOn);

    // if you need to return an error to show the device as "Not Responding" in the Home app:
    // throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);

    return isOn;
  }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, changing the Brightness
   */
  async setBrightness(value: CharacteristicValue) {
    // implement your own code to set the brightness
    this.exampleStates.Brightness = value as number;

    this.platform.log.debug('Set Characteristic Brightness -> ', value);
  }



}
