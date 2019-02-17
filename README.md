# homebridge-gogogate2

[Gogogate 2](https://www.gogogate.com) plugin for [HomeBridge](https://github.com/nfarina/homebridge) using http calls.

> ## Work In Progress

This plugin is inteneded to add yours doors connected to gogogate to homekit. It can update in the background so that openning / closing outside home app can trigger your automations.

> List of known issues:
>
> - Updating /refreshing might not be always reliable
> - In case of network loss, not sur it will reconnect
> - platform is not dynamic, so we brake at startup if gogogate is not reachable / can't give the doors. can be improved.

## Installation

1. Install Homebridge using: `npm install -g homebridge`
2. Install this plugin using: `npm install -g homebridge-gogogate2`
3. Update your Homebridge `config.json` using the sample below.

## Configuration

```json
"platforms": [
  {
    "platform": "GogoGate2",
    "name": "GogoGate2",
    "gogogateIP": "192.168.1.47",
    "username": "",
    "password": "",
    "refreshTimer": "120",
    "maxWaitTimeForOperation": "30s",
    "refreshTimerDuringOperartion": "5"
  }
]
```

Fields:

- `platform` must be "GogoGate2" (required).
- `name` is the name of the published accessory (required).
- `gogogateIP` is the static IP address of the gogogate (required). A static IP address is required.
- `username` your username for accessing the gate (must be admin)
- `password` your password
- `refreshTimer` Optional - enable refresh of doors state every X seconds, for automation purpose if you need to activate something else based on a state change of a door by another means than homekit. Be aware it might make you gogoggate smokes since the plugin will ask its status very often :) (defaults : disable, accepted range : 30-600s).
- `maxWaitTimeForOperation` Optional - set the maximum time that we wait for door operation to complete. When elapsed, check the current State again and updates accordingly. (defaults : 30s, accepted range : 30-90s).
- `refreshTimerDuringOperation` Optional - set the refresh timer during operation in progress to detect the end of the operation. (defaults : 10s, accepted range : 2-15s).

## Changelog

- 0.1.1
  - [FIX] handle json parse error for sensor #14
- 0.1.0
  - [BREAKING] renamed refreshTimerDuringOperartion option to refreshTimerDuringOperation
  - [FIX] While opening, door might switch from opening to closing in home app before completion of operation #13
- 0.0.9
  - [FIX] crash with multiple doors #11
  - [FIX] temperature sensor for all sensors #12
- 0.0.8
  - [NEW] temp sensor and battery level of garage door sensor on doors which have one .
  - [NEW] moving each door as an accessory - You might need to empty your cache folder .
- 0.0.7
  - [FIX] crash on error
- 0.0.5
  - [FIX] crash homebridge when activating door
- 0.0.4
  - [FIX] Prevent loosing doors if error at homebridge startup (can't login / gogogate unreachable).
- 0.0.3
  - [NEW] New optionnal option for state refresh timer during operation of doors.
  - [FIX] handling login error.
- 0.0.2
  - [NEW] Update and fixes
- 0.0.1
  - [NEW] First version

## Inspiration

Thanks to [dlbroadfoot/pygogogate2/blob/master/pygogogate2/**init**.py](https://github.com/dlbroadfoot/pygogogate2) for the API calls.
