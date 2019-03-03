TEMP_SENSOR = 'Temperature';
BATTERY_SENSOR = 'Battery';

var Service, Characteristic;
var request = require('request');
const $ = require('cheerio');

String.prototype.isEmpty = function() {
  return this.length === 0 || !this.trim();
};

function Gogogate2Platform(log, config, api) {
  this.log = log;
  this.gogogateIP = config['gogogateIP'];
  this.name = config['name'];
  this.devMode = config['DEVMODE'];
  this.username = config['username'];
  this.password = config['password'];
  this.refreshTimer = checkTimer(config['refreshTimer']);
  this.refreshTimerDuringOperation = checkParemeter(
    config['refreshTimerDuringOperation'],
    2,
    15,
    10
  );
  this.maxWaitTimeForOperation = checkParemeter(
    config['maxWaitTimeForOperation'],
    30,
    90,
    30
  );
  this.foundAccessories = [];

  this.doors = [];
  request = request.defaults({jar: true});

  if (api) {
    // Save the API object as plugin needs to register new accessory via this object
    this.api = api;

    // Listen to event "didFinishLaunching", this means homebridge already finished loading cached accessories.
    // Platform Plugin should only register new accessory that doesn't exist in homebridge after this event.
    // Or start discover new accessories.
    this.api.on('shutdown', this.end());
  }
}

module.exports = function(homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  HomebridgeAPI = homebridge;
  homebridge.registerPlatform(
    'homebridge-gogogate2',
    'GogoGate2',
    Gogogate2Platform
  );
};

Gogogate2Platform.prototype = {
  getStateString(state) {
    if (state == 0) return 'OPEN';
    else if (state == 1) return 'CLOSED';
    else if (state == 2) return 'OPENING';
    else if (state == 3) return 'CLOSING';
    else if (state == 4) return 'STOPPED';
  },

  end() {
    this.log('INFO - shutdown');
    if (this.timerID) {
      clearInterval(this.timerID);
      this.timerID = undefined;
    }

    this.logout();
  },

  handleError(statuserror) {
    //ERRORS :

    // no network connectivity
    // ENETUNREACH
    // EHOSTUNREACH

    // not responding
    // ETIMEDOUT

    //auth error
    // ECONNREFUSED
    this.log.debug(statuserror);
    // if we have a login error, try to reconnect
    if (
      (statuserror &&
        statuserror.code &&
        statuserror.code.includes('ECONNREFUSED')) ||
      (statuserror &&
        statuserror instanceof String &&
        statuserror.includes('Restricted Access'))
    ) {
      this.log(
        'WARNING - handleError - Connection refused, trying to reconnect'
      );
      this.logout(() => {
        this.login(success => {
          if (success) {
            this.log('INFO - handleError - Reconnection is ok');
          }
        });
      });
    }
    // check for network connectivity
    else if (
      statuserror &&
      (statuserror.code.includes('ENETUNREACH') ||
        statuserror.code.includes('EHOSTUNREACH'))
    ) {
      //Try to send a WOL ?
      this.log(
        'ERROR - handleError - No network connectivity, check gogogate accessibility'
      );
    }
    //else print error
    else if (statuserror && statuserror.code.includes('ETIMEDOUT')) {
      //Try to send a WOL ?
      this.log(
        'ERROR - handleError - timeout connecting to gogogate, check gogogate connectivity'
      );
    }
  },

  refreshBackground() {
    //timer for background refresh
    if (this.refreshTimer !== undefined && this.refreshTimer > 0) {
      this.log.debug(
        'INFO - Setting Timer for background refresh every  : ' +
          this.refreshTimer +
          's'
      );
      this.timerID = setInterval(
        () => this.refreshAllDoors(),
        this.refreshTimer * 1000
      );
    }
  },

  accessories: function(callback) {
    this.login(success => {
      if (success) {
        this.getDoors(successDoors => {
          if (successDoors) {
            this.handleDoorsDiscovery();
            //timer for background refresh
            this.refreshBackground();

            callback(this.foundAccessories);
          } else {
            //prevent homebridge from starting since we don't want to loose our doors.
            callback(undefined);
          }
        });
      } else {
        //prevent homebridge from starting since we don't want to loose our doors.
        callback(undefined);
      }
    });
  },

  handleDoorsDiscovery() {
    for (let i = 0, len = this.doors.length; i < len; i++) {
      let services = [];
      let doorName = this.doors[i];

      if (doorName && !doorName.isEmpty()) {
        if (this.devMode) {
          doorName = 'DEV' + doorName;
        }
        this.log('INFO - Discovered door : ' + doorName);

        let chars = [];
        chars.push(Characteristic.CurrentDoorState);
        chars.push(Characteristic.TargetDoorState);
        chars.push(Characteristic.ObstructionDetected);

        let service = {
          controlService: new Service.GarageDoorOpener(doorName),
          characteristics: chars,
        };
        service.controlService.subtype = doorName;
        service.controlService.id = i + 1;
        service.id = doorName;
        services.push(service);

        if (this.sensors[i] && !this.sensors[i].isEmpty()) {
          this.log('INFO - Discovered sensor : ' + this.sensors[i]);
          let batteryService = {
            controlService: new Service.BatteryService(),
            characteristics: [
              Characteristic.BatteryLevel,
              Characteristic.ChargingState,
              Characteristic.StatusLowBattery,
            ],
          };
          batteryService.controlService.subtype = doorName;
          batteryService.controlService.id = i + 1;
          batteryService.id = 'Battery' + this.sensors[i];
          services.push(batteryService);

          let tempService = {
            controlService: new Service.TemperatureSensor(),
            characteristics: [Characteristic.CurrentTemperature],
          };
          tempService.controlService.subtype = doorName;
          tempService.controlService.id = i + 1;
          tempService.id = 'Temp' + this.sensors[i];
          services.push(tempService);
        }

        let myGogogateDoorAccessory = new Gogogate2Accessory(services);
        myGogogateDoorAccessory.getServices = function() {
          return this.platform.getServices(myGogogateDoorAccessory);
        };
        myGogogateDoorAccessory.platform = this;
        myGogogateDoorAccessory.name = doorName;
        myGogogateDoorAccessory.model = 'Gogogate2';
        myGogogateDoorAccessory.manufacturer = 'Gogogate';
        myGogogateDoorAccessory.serialNumber = doorName + '-' + this.gogogateIP;

        this.foundAccessories.push(myGogogateDoorAccessory);
      }
    }
  },

  login: function(callback) {
    let formData = {
      login: this.username,
      pass: this.password,
      'sesion-abierta': '1',
      'send-login': 'submit',
    };
    let baseURL = 'http://' + this.gogogateIP + '/index.php';

    var that = this;

    that.log.debug('INFO - LOGIN - trying to log');

    request.post({url: baseURL, formData: formData}, function optionalCallback(
      loginerr,
      loginResponse,
      loginbody
    ) {
      if (loginerr) {
        that.log('ERROR - LOGIN - login failed:', loginerr);
        callback(false);
      } else if (loginbody && loginbody.includes('Wrong login or password')) {
        that.log('ERROR - LOGIN - Wrong login or password');
        callback(false);
      } else {
        that.log.debug('INFO - LOGIN - login ok');
        callback(true);
      }
    });
  },

  logout: function(callback) {
    let formData = {
      logout: 'submit',
    };
    let baseURL = 'http://' + this.gogogateIP + '/index.php';

    var that = this;

    that.log.debug('INFO - Logout - trying to logout');

    request.post({url: baseURL, formData: formData}, function optionalCallback(
      logouterr,
      logoutResponse,
      logoutbody
    ) {
      if (logouterr) {
        that.log(
          'ERROR - LOGOUT - logout failed :',
          logouterr + '-' + logoutResponse + '-' + logoutbody
        );
        callback(false);
      } else {
        callback(true);
      }
    });
  },

  getDoors: function(callback) {
    let infoURL =
      'http://' + this.gogogateIP + '/index.php?op=config&opc=doors';

    var that = this;

    request(infoURL, function optionalCallback(
      statuserror,
      statusresponse,
      statusbody
    ) {
      if (statuserror) {
        that.log('ERROR - getDoors - Can not retrieve doors');
        callback(false);
      } else {
        that.doors = [
          $('input[name="dname1"]', '#config-door1', statusbody).val(),
          $('input[name="dname2"]', '#config-door2', statusbody).val(),
          $('input[name="dname3"]', '#config-door3', statusbody).val(),
        ];
        that.sensors = [
          $('input[name="door1"]', '#config-door1', statusbody).val(),
          $('input[name="door2"]', '#config-door2', statusbody).val(),
          $('input[name="door3"]', '#config-door3', statusbody).val(),
        ];
        that.log.debug('INFO - DOORS NAMES found : ' + that.doors);
        callback(true);
      }
    });
  },

  refreshAllDoors: function() {
    this.log.debug('INFO - Refreshing status ');

    for (let a = 0; a < this.foundAccessories.length; a++) {
      let myGogogateAccessory = this.foundAccessories[a];

      for (let s = 0; s < myGogogateAccessory.services.length; s++) {
        let service = myGogogateAccessory.services[s];

        if (service.controlService instanceof Service.GarageDoorOpener) {
          this.log.debug(
            'INFO - refreshAllDoors - Door : ' + service.controlService.subtype
          );
          this.refreshDoor(myGogogateAccessory, service);
        } else if (
          service.controlService instanceof Service.TemperatureSensor
        ) {
          this.log.debug(
            'INFO - refreshAllDoors - Temp : ' + service.controlService.subtype
          );
          this.refreshSensor(myGogogateAccessory, service, null, TEMP_SENSOR);
        } else if (service.controlService instanceof Service.BatteryService) {
          this.log.debug(
            'INFO - refreshAllDoors - Battery : ' +
              service.controlService.subtype
          );
          this.refreshSensor(
            myGogogateAccessory,
            service,
            null,
            BATTERY_SENSOR
          );
        }
      }
    }
  },

  getNewValue: function(
    myGogogateAccessory,
    service,
    currentDoorState,
    oldValue
  ) {
    let newValue = undefined;

    if (
      service.TargetDoorState !== undefined &&
      service.TargetDoorState == currentDoorState
    ) {
      this.endDoorOperation(myGogogateAccessory, service);
      let newValue = currentDoorState;
      this.log.debug(
        'WARNING - refreshDoor - ' +
          service.controlService.subtype +
          ' - OPENING operation was in progress and is achieved: ' +
          this.getStateString(newValue)
      );
    } else if (service.TargetDoorState == undefined) {
      //no operation in progress, we retrieve the real state
      newValue = currentDoorState;
      this.log.debug(
        'INFO - refreshDoor  - ' +
          service.controlService.subtype +
          ' - no operation in progress, we retrieve the real state: ' +
          this.getStateString(newValue)
      );
    }

    if (newValue == undefined) {
      that.log.debug(
        'INFO - refreshDoor - ' +
          service.controlService.subtype +
          ' No new value'
      );
      newValue = oldValue;
    }

    return newValue;
  },

  refreshDoor: function(myGogogateAccessory, service, callback) {
    var that = this;

    let infoURL =
      'http://' +
      this.gogogateIP +
      '/isg/statusDoor.php?numdoor=' +
      service.controlService.id;

    request(infoURL, function optionalCallback(
      statuserror,
      statusresponse,
      statusbody
    ) {
      if (statuserror) {
        that.log(
          'ERROR - refreshDoor - Refreshing status for ' +
            service.controlService.subtype +
            ' Door failed - ' +
            statusresponse
        );
        that.handleError(statuserror);

        if (callback) callback(undefined, undefined);
      } else {
        that.handleRefreshDoor(
          statusbody,
          myGogogateAccessory,
          service,
          callback
        );
      }
    });
  },

  handleRefreshDoor(statusbody, myGogogateAccessory, service, callback) {
    this.log.debug(
      'INFO - refreshDoor - Got Status for : ' +
        service.controlService.subtype +
        ' - ' +
        statusbody +
        '. ServiceTargetState is ' +
        this.getStateString(service.TargetDoorState)
    );

    //timeout
    let elapsedTime = Date.now() - service.TargetDoorStateOperationStart;

    if (
      service.TargetDoorState !== undefined &&
      elapsedTime > this.maxWaitTimeForOperation * 1000
    ) {
      //operation has timedout
      this.endDoorOperation(myGogogateAccessory, service);
      this.log.debug(
        'WARNING - refreshDoor - ' +
          service.controlService.subtype +
          ' - operation was in progress and  has timedout'
      );
    }

    let oldValue = service.controlService.getCharacteristic(
      Characteristic.CurrentDoorState
    ).value;

    this.log.debug(
      'INFO - refreshDoor - Current Door State ' + that.getStateString(oldValue)
    );

    let newValue = this.getNewValue(
      myGogogateAccessory,
      service,
      statusbody == 'OK'
        ? Characteristic.CurrentDoorState.OPEN
        : Characteristic.CurrentDoorState.CLOSED,
      oldValue
    );

    if (callback) {
      this.log.debug(
        'INFO - refreshDoor - ' +
          service.controlService.subtype +
          ' calling callback with value : ' +
          this.getStateString(newValue)
      );
      callback(undefined, newValue);
    } else if (newValue != oldValue) {
      this.log.debug(
        'INFO - refreshDoor - ' +
          service.controlService.subtype +
          ' updating characteristics to : ' +
          this.getStateString(newValue)
      );

      service.controlService
        .getCharacteristic(Characteristic.CurrentDoorState)
        .updateValue(newValue);

      if (
        newValue == Characteristic.CurrentDoorState.OPEN ||
        newValue == Characteristic.CurrentDoorState.CLOSED
      ) {
        service.controlService
          .getCharacteristic(Characteristic.TargetDoorState)
          .updateValue(newValue);
      }
    }
  },

  refreshSensor: function(myGogogateAccessory, service, callback, type) {
    var that = this;

    let infoURL =
      'http://' +
      this.gogogateIP +
      '/isg/temperature.php?door=' +
      service.controlService.id;

    request(infoURL, function optionalCallback(
      statuserror,
      statusresponse,
      statusbody
    ) {
      if (statuserror) {
        that.log('ERROR - refreshSensor -  failed');
        that.handleError(statuserror);
        if (callback) callback(undefined, undefined);
      } else if (!IsJsonString(statusbody)) {
        that.log('ERROR - refreshSensor -  failed');
        that.log(
          'ERROR - refreshSensor -  no JSON body : ' +
            statusbody +
            '-' +
            statusresponse
        );
        that.handleError(statusbody);
        if (callback) callback(undefined, undefined);
      } else {
        that.handleRefreshSensor(statusbody, callback);
      }
    });
  },

  handleRefreshSensor(statusbody, callback) {
    this.log.debug('INFO - refreshSensor with body  : ' + statusbody);

    let res = JSON.parse(statusbody);

    let newVal;
    let charToUpdate = undefined;
    if (type == BATTERY_SENSOR) {
      newVal = normalizeBattery(res[1]);
      charToUpdate = Characteristic.BatteryLevel;
      this.log.debug('INFO - refreshBattery with value  : ' + newVal);
    } else {
      newVal = res[0] / 1000;
      charToUpdate = Characteristic.CurrentTemperature;
      this.log.debug('INFO - refreshTemp with value  : ' + newVal);
    }

    if (callback) {
      callback(undefined, newVal);
    } else {
      service.controlService
        .getCharacteristic(charToUpdate)
        .updateValue(newVal);
    }
  },

  activateDoor: function(controlService, callback) {
    let commandURL =
      'http://' +
      this.gogogateIP +
      '/isg/opendoor.php?numdoor=' +
      controlService.id;

    var that = this;

    request(commandURL, function optionalCallback(
      statuserror,
      statusresponse,
      statusbody
    ) {
      if (statuserror) {
        that.log(
          'ERROR - activateDoor - ERROR while sending command -' +
            statusresponse +
            '-' +
            statusbody
        );
        that.handleError(statuserror);

        callback(true);
      } else {
        that.log.debug(
          'INFO - activateDoor - Command sent to ' + controlService.subtype
        );
        callback(false);
      }
    });
  },

  getCurrentDoorStateCharacteristic: function(
    homebridgeAccessory,
    service,
    callback
  ) {
    if (
      service.TargetDoorState &&
      service.TargetDoorState == Characteristic.TargetDoorState.OPEN
    ) {
      this.log.debug(
        'INFO - GET Characteristic.CurrentDoorState - ' +
          service.controlService.subtype +
          ' - OPENING'
      );
      callback(undefined, Characteristic.CurrentDoorState.OPENING);
    } else if (
      service.TargetDoorState &&
      service.TargetDoorState == Characteristic.TargetDoorState.CLOSED
    ) {
      this.log.debug(
        'INFO - GET Characteristic.CurrentDoorState - ' +
          service.controlService.subtype +
          ' - CLOSING'
      );
      callback(undefined, Characteristic.CurrentDoorState.CLOSING);
    } else {
      this.log.debug(
        'INFO - GET Characteristic.CurrentDoorState - ' +
          service.controlService.subtype +
          ' - Real state through REFRESHDOOR'
      );

      homebridgeAccessory.platform.refreshDoor(
        homebridgeAccessory,
        service,
        callback
      );
    }
  },

  getTargetDoorStateCharacteristic: function(
    homebridgeAccessory,
    service,
    callback
  ) {
    if (service.TargetDoorState) {
      this.log.debug(
        'INFO - GET Characteristic.TargetDoorState - ' +
          service.controlService.subtype +
          ' - callback with state : ' +
          this.getStateString(service.TargetDoorState)
      );

      callback(undefined, service.TargetDoorState);
    } else {
      this.log.debug(
        'INFO - GET Characteristic.TargetDoorState - ' +
          service.controlService.subtype +
          ' - Real state through REFRESHDOOR'
      );

      homebridgeAccessory.platform.refreshDoor(
        homebridgeAccessory,
        service,
        callback
      );
    }
  },

  setTargetDoorStateCharacteristic: function(
    homebridgeAccessory,
    service,
    characteristic,
    value,
    callback
  ) {
    var currentValue = characteristic.value;
    var currentState = service.controlService.getCharacteristic(
      Characteristic.CurrentDoorState
    ).value;
    var that = this;

    if (
      currentState != value &&
      (currentState == Characteristic.CurrentDoorState.OPEN ||
        currentState == Characteristic.CurrentDoorState.CLOSED)
    ) {
      this.log.debug(
        'INFO - SET Characteristic.TargetDoorState - ' +
          service.controlService.subtype +
          ' - CurrentDoorState is ' +
          this.getStateString(currentState)
      );

      homebridgeAccessory.platform.activateDoor(
        service.controlService,
        function(error) {
          if (error) {
            that.endDoorOperation(homebridgeAccessory, service);
            setTimeout(function() {
              characteristic.updateValue(currentValue);
            }, 200);
            that.log.debug(
              'ERROR - SET Characteristic.TargetDoorState - ' +
                service.controlService.subtype +
                ' error activating '
            );
          } else {
            that.beginDoorOperation(service, value);

            service.controlService
              .getCharacteristic(Characteristic.CurrentDoorState)
              .updateValue(
                currentState == Characteristic.CurrentDoorState.OPEN
                  ? Characteristic.CurrentDoorState.CLOSING
                  : Characteristic.CurrentDoorState.OPENING
              );

            that.log.debug(
              'INFO - SET Characteristic.TargetDoorState - ' +
                service.controlService.subtype +
                ' success activating '
            );
          }
        }
      );
    }
    callback();
  },

  bindCurrentDoorStateCharacteristic: function(
    characteristic,
    service,
    homebridgeAccessory
  ) {
    characteristic.on(
      'get',
      function(callback) {
        homebridgeAccessory.platform.getCurrentDoorStateCharacteristic(
          homebridgeAccessory,
          service,
          callback
        );
      }.bind(this)
    );
  },

  bindTargetDoorStateCharacteristic: function(
    characteristic,
    service,
    homebridgeAccessory
  ) {
    characteristic.on(
      'get',
      function(callback) {
        homebridgeAccessory.platform.getTargetDoorStateCharacteristic(
          homebridgeAccessory,
          service,
          callback
        );
      }.bind(this)
    );

    characteristic.on(
      'set',
      function(value, callback) {
        homebridgeAccessory.platform.setTargetDoorStateCharacteristic(
          homebridgeAccessory,
          service,
          characteristic,
          value,
          callback
        );
      }.bind(this)
    );
  },

  bindObstructionDetectedCharacteristic: function(
    characteristic,
    service,
    homebridgeAccessory
  ) {
    characteristic.on(
      'get',
      function(callback) {
        callback(undefined, false);
      }.bind(this)
    );
  },

  bindCurrentTemperatureCharacteristic: function(
    characteristic,
    service,
    homebridgeAccessory
  ) {
    characteristic.on(
      'get',
      function(callback) {
        homebridgeAccessory.platform.refreshSensor(
          homebridgeAccessory,
          service,
          callback,
          TEMP_SENSOR
        );
      }.bind(this)
    );
  },

  bindBatteryLevelCharacteristic: function(
    characteristic,
    service,
    homebridgeAccessory
  ) {
    characteristic.on(
      'get',
      function(callback) {
        homebridgeAccessory.platform.refreshSensor(
          homebridgeAccessory,
          service,
          callback,
          BATTERY_SENSOR
        );
      }.bind(this)
    );
  },

  bindChargingStateCharacteristic: function(
    characteristic,
    service,
    homebridgeAccessory
  ) {
    characteristic.on(
      'get',
      function(callback) {
        callback(undefined, false);
      }.bind(this)
    );
  },

  bindStatusLowBatteryCharacteristic: function(
    characteristic,
    service,
    homebridgeAccessory
  ) {
    characteristic.on(
      'get',
      function(callback) {
        callback(
          undefined,
          service.controlService.getCharacteristic(
            Characteristic.BatteryLevel
          ) == 0
        );
      }.bind(this)
    );
  },

  bindCharacteristicEvents: function(
    characteristic,
    service,
    homebridgeAccessory
  ) {
    switch (true) {
      case characteristic instanceof Characteristic.CurrentDoorState:
        this.bindCurrentDoorStateCharacteristic(
          characteristic,
          service,
          homebridgeAccessory
        );
        break;
      case characteristic instanceof Characteristic.TargetDoorState:
        this.bindTargetDoorStateCharacteristic(
          characteristic,
          service,
          homebridgeAccessory
        );
        break;
      case characteristic instanceof Characteristic.ObstructionDetected:
        this.bindObstructionDetectedCharacteristic(
          characteristic,
          service,
          homebridgeAccessory
        );
        break;
      case characteristic instanceof Characteristic.CurrentTemperature:
        this.bindCurrentTemperatureCharacteristic(
          characteristic,
          service,
          homebridgeAccessory
        );
        break;
      case characteristic instanceof Characteristic.BatteryLevel:
        this.bindBatteryLevelCharacteristic(
          characteristic,
          service,
          homebridgeAccessory
        );
        break;
      case characteristic instanceof Characteristic.ChargingState:
        this.bindChargingStateCharacteristic(
          characteristic,
          service,
          homebridgeAccessory
        );
        break;
      case characteristic instanceof Characteristic.StatusLowBattery:
        this.bindStatusLowBatteryCharacteristic(
          characteristic,
          service,
          homebridgeAccessory
        );
        break;
    }
  },

  beginDoorOperation(service, state) {
    //stop timer if one exists.

    if (this.timerID) {
      clearInterval(this.timerID);
      this.timerID = undefined;
    }

    service.TargetDoorState = state;
    service.TargetDoorStateOperationStart = Date.now();

    //start operating timer
    this.log.debug(
      'INFO - beginDoorOperation - ' +
        service.controlService.subtype +
        ' - Setting Timer for operation'
    );

    this.timerID = setInterval(() => {
      this.refreshAllDoors();
    }, this.refreshTimerDuringOperation * 1000);
  },

  endDoorOperation(myGogogateAccessory, service) {
    //stop timer for this operation
    this.log.debug(
      'INFO - endDoorOperation - ' +
        service.controlService.subtype +
        ' - Stopping operation Timer'
    );

    service.TargetDoorState = undefined;
    service.TargetDoorStateOperationStart = undefined;

    this.checkEndOperation(myGogogateAccessory);
  },

  checkEndOperation(myGogogateAccessory) {
    //clear timer and set background again if no other operation in progress
    if (this.timerID) {
      let operationInProgress = false;
      for (let s = 0; s < myGogogateAccessory.services.length; s++) {
        let service = myGogogateAccessory.services[s];
        if (service.TargetDoorStateOperationStart) {
          operationInProgress = true;
          break;
        }
      }

      if (!operationInProgress) {
        clearInterval(this.timerID);
        this.timerID = undefined;
        this.refreshBackground();
      }
    }
  },

  getInformationService: function(homebridgeAccessory) {
    let informationService = new Service.AccessoryInformation();
    informationService
      .setCharacteristic(Characteristic.Name, homebridgeAccessory.name)
      .setCharacteristic(
        Characteristic.Manufacturer,
        homebridgeAccessory.manufacturer
      )
      .setCharacteristic(Characteristic.Model, homebridgeAccessory.model)
      .setCharacteristic(
        Characteristic.SerialNumber,
        homebridgeAccessory.serialNumber
      );
    return informationService;
  },

  getServices: function(homebridgeAccessory) {
    let services = [];
    let informationService = homebridgeAccessory.platform.getInformationService(
      homebridgeAccessory
    );
    services.push(informationService);
    for (let s = 0; s < homebridgeAccessory.services.length; s++) {
      let service = homebridgeAccessory.services[s];
      for (let i = 0; i < service.characteristics.length; i++) {
        let characteristic = service.controlService.getCharacteristic(
          service.characteristics[i]
        );
        if (characteristic == undefined)
          characteristic = service.controlService.addCharacteristic(
            service.characteristics[i]
          );
        homebridgeAccessory.platform.bindCharacteristicEvents(
          characteristic,
          service,
          homebridgeAccessory
        );
      }
      services.push(service.controlService);
    }
    return services;
  },
};

function Gogogate2Accessory(services) {
  this.services = services;
}

function IsJsonString(str) {
  try {
    JSON.parse(str);
  } catch (e) {
    return false;
  }
  return true;
}

function checkTimer(timer) {
  if (timer && timer > 0 && (timer < 30 || timer > 600)) return 180;
  else return timer;
}

function checkParemeter(parameter, min, max, def) {
  if (parameter == undefined || (parameter < min || parameter > max))
    return def;
  else return parameter;
}

function normalizeBattery(val) {
  if (val == 'full') {
    return 100;
  } else if (val == 'low') {
    return 0;
  } else {
    return val;
  }
}
