# homebridge-gogogate2

[Gogogate 2](https://www.gogogate.com) plugin for [HomeBridge](https://github.com/nfarina/homebridge) using http calls.

> ## Work In Progress
>
> List of known issues:
>
> - Early beginning ...


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
    "gogogateIP": "192.168.1.47"
  }
]
```

Fields:

- `platform` must be "GogoGate2" (required).
- `name` is the name of the published accessory (required).
- `gogogateIP` is the static IP address of the gogogate (required). A static IP address is required.


## Changelog
- 0.0.1
  - [NEW] First version

## Inspiration

Thanks to [dlbroadfoot/pygogogate2/blob/master/pygogogate2/__init__.py](https://github.com/dlbroadfoot/pygogogate2) for the API calls.
