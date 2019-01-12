# homebridge-gogogate2

[Gogogate 2](https://www.gogogate.com) plugin for [HomeBridge](https://github.com/nfarina/homebridge) using http calls.

> ## Work In Progress

This plugin is inteneded to add yours doors connected to gogogate to homekit. It can update in the background so that openning / closing outside home app can trigger your automations.

> List of known issues:
>
> - Updating /refreshing might not be reliable
> - In case of network loss, not sur it will reconnect

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

  }
]
```

Fields:

- `platform` must be "GogoGate2" (required).
- `name` is the name of the published accessory (required).
- `gogogateIP` is the static IP address of the gogogate (required). A static IP address is required.
- `username` your username for accessing the gate (must be admin)
- `password` your password
- `refreshTimer` enable refresh of doors state every X seconds, for automation purpose if you need to activate something else based on a state change of a door by another means than homekit. Be aware it might make you gogoggate smokes since the plugin will ask its status very often :) (defaults : disable, accepted range : 30-600s).
- `maxWaitTimeForOperation` set the maximum time that we wait for door operation to complete. When elapsed, check the current State again and updates accordingly. (defaults : 30s, accepted range : 30-90s).

## Changelog

- 0.0.2
  - [NEW] Update and fixes
- 0.0.1
  - [NEW] First version

## Inspiration

Thanks to [dlbroadfoot/pygogogate2/blob/master/pygogogate2/**init**.py](https://github.com/dlbroadfoot/pygogogate2) for the API calls.
