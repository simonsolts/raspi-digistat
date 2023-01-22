# RaspiDigistat: Make your Drayton Wiser Bluetooth thermostats available to Apple HomeKit
This bridges bluetooth thermostats to Apple's HomeKit via Homebridge, allowing them to show up in your home and be controlled remotely!

I am not affilliated with Drayton, Schneider Electric or Apple. Their product names are subject to their trademarks.

Use at your own risk. Sofware is provided as-is with no warranty. 

# Requirements
This is a work in progress and no support is provided. 

My configuration is as follows:
* Drayton Bluetooth RF902 Digistat
* Raspberry Pi 4
* Homebridge running on the Pi, as a service, with a user `homebridge` (hb-service)
* SSH access to the PI

# Pre-install
You will need to pair your thermostats with the Raspberry Pi. 

To do this, your Pi will probably need some additional software installed: 

Install Bluetooth Tools
```
sudo apt install bluetooth libbluetooth-dev bluez
```

## Connect to the Thermostat
1. Locate the MAC address on the back of the thermostat, it looks like 00:11:22:33:44:55
2. Press and hold the large button on the front of the thermosat to put it into pairing mode
3. From the command line on your Pi, run the following: 
```
  sudo bluetoothctl
  scan on
  pairable on
  connect 00:11:22:33:44:55 #replace with your device ID
  pair 00:11:22:33:44:55 #dont worry if it says unsuccessful at this point
  #confirm the pairing request if asked by matching the number on screen to the number on the thermostats screen
  trust 00:11:22:33:44:55
  exit
```
4. Repeat for all thermostats

## Install Homebridge
Beyond the scope of this readme

## Install the Homebridge plugin
1. Log in to your PI 
2. Log in as the homebridge user: `sudo -su homebridge`
3. Clone this repo to your homebridge user's homedir (`cd ~ && git clone git@github.com:simonsolts/raspi-digistat.git`)
4. CD into the directory that was just made
5. Edit the `devices` array in `platform.ts` to add your thermostats
5. `npm install`
6. `npm build`
7. `sudo npm link`

## Add the plugin to homebridge
In homebridge config editor, add / amend the following sections of config:
```

    "plugins": [
        ...
        "homebridge-raspi-digistat"
    ],
    "platforms": [
        ...
        {
            "name": "Digistat",
            "platform": "Digistat"
        }
```

