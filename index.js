TEMP_SENSOR = 'Temperature';
BATTERY_SENSOR = 'Battery';

var Service, Characteristic;
var request = require('request');
const url = require('url');
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
  this.refreshTimer = config['refreshTimer'];
  this.refreshTimerDuringOperation = config['refreshTimerDuringOperation'];
  this.foundAccessories = [];

  if (
    this.refreshTimer &&
    this.refreshTimer > 0 &&
    (this.refreshTimer < 30 || this.refreshTimer > 600)
  )
    this.refreshTimer = 180;

  this.maxWaitTimeForOperation = config['maxWaitTimeForOperation'];

  if (
    this.maxWaitTimeForOperation == undefined ||
    (this.maxWaitTimeForOperation < 30 || this.maxWaitTimeForOperation > 90)
  )
    this.maxWaitTimeForOperation = 30;

  if (
    this.refreshTimerDuringOperation == undefined ||
    (this.refreshTimerDuringOperation < 2 ||
      this.refreshTimerDuringOperation > 15)
  )
    this.refreshTimerDuringOperation = 10;

  this.doors = [];
  request = request.defaults({jar: true});

  if (api) {
    // Save the API object as plugin needs to register new accessory via this object
    this.api = api;

    // Listen to event "didFinishLaunching", this means homebridge already finished loading cached accessories.
    // Platform Plugin should only register new accessory that doesn't exist in homebridge after this event.
    // Or start discover new accessories.
    var that = this;
    this.api.on(
      'shutdown',
      function() {
        that.log('INFO - shutdown');
        if (that.timerID) {
          clearInterval(that.timerID);
          that.timerID = undefined;
        }

        that.logout(success => {
          if (success) {
            that.log('INFO - log out');
          } else {
            that.log('ERROR - Can not logout');
          }
        });
      }.bind(this)
    );
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
      statuserror &&
      ((statuserror.code && statuserror.code.includes('ECONNREFUSED')) ||
        statuserror.includes('Restricted Access'))
    ) {
      this.log(
        'WARNING - handleError - Connection refused, trying to reconnect'
      );
      this.logout(noerror => {
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
                myGogogateDoorAccessory.serialNumber =
                  doorName + '-' + this.gogogateIP;

                this.foundAccessories.push(myGogogateDoorAccessory);
              }
            }

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
        that.log('ERROR - LOGOUT - logout failed :', logouterr);
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
            ' Door failed:'
        );
        that.handleError(statuserror);

        if (callback) callback(undefined, undefined);
      } else {
        that.log.debug(
          'INFO - refreshDoor - Got Status for : ' +
            service.controlService.subtype +
            ' - ' +
            statusbody +
            '. ServiceTargetState is ' +
            that.getStateString(service.TargetDoorState)
        );

        //timeout
        let elapsedTime = Date.now() - service.TargetDoorStateOperationStart;

        if (
          service.TargetDoorState !== undefined &&
          elapsedTime > that.maxWaitTimeForOperation * 1000
        ) {
          //operation has timedout
          that.endDoorOperation(myGogogateAccessory, service);
          that.log.debug(
            'WARNING - refreshDoor - ' +
              service.controlService.subtype +
              ' - operation was in progress and  has timedout'
          );
        }

        let oldValue = service.controlService.getCharacteristic(
          Characteristic.CurrentDoorState
        ).value;

        let newValue = undefined;

        that.log.debug(
          'INFO - refreshDoor - Current Door State ' +
            that.getStateString(oldValue)
        );

        if (statusbody == 'OK') {
          if (
            service.TargetDoorState !== undefined &&
            service.TargetDoorState == Characteristic.CurrentDoorState.OPEN
          ) {
            that.endDoorOperation(myGogogateAccessory, service);
            newValue = Characteristic.CurrentDoorState.OPEN;
            that.log.debug(
              'WARNING - refreshDoor - ' +
                service.controlService.subtype +
                ' - OPENING operation was in progress and is achieved: ' +
                that.getStateString(newValue)
            );
          } else if (service.TargetDoorState == undefined) {
            //no operation in progress, we retrieve the real state
            newValue = Characteristic.CurrentDoorState.OPEN;
            that.log.debug(
              'INFO - refreshDoor  - ' +
                service.controlService.subtype +
                ' - no operation in progress, we retrieve the real state: ' +
                that.getStateString(newValue)
            );
          }
        } else {
          if (
            service.TargetDoorState !== undefined &&
            service.TargetDoorState == Characteristic.CurrentDoorState.CLOSED
          ) {
            //operation was in progress and is achieved or has timedout
            that.endDoorOperation(myGogogateAccessory, service);
            newValue = Characteristic.CurrentDoorState.CLOSED;
            that.log.debug(
              'INFO - refreshDoor - ' +
                service.controlService.subtype +
                ' - CLOSED operation was in progress and is achieved ' +
                that.getStateString(newValue)
            );
          } else if (service.TargetDoorState == undefined) {
            //no operation in progress, we retrieve the real state
            newValue = Characteristic.CurrentDoorState.CLOSED;
            that.log.debug(
              'INFO - refreshDoor - ' +
                service.controlService.subtype +
                ' - no operation in progress, we retrieve the real state ' +
                that.getStateString(newValue)
            );
          }
        }

        if (newValue == undefined) {
          that.log.debug(
            'INFO - refreshDoor - ' +
              service.controlService.subtype +
              ' No new value'
          );
          newValue = oldValue;
        }

        if (callback) {
          that.log.debug(
            'INFO - refreshDoor - ' +
              service.controlService.subtype +
              ' calling callback with value : ' +
              that.getStateString(newValue)
          );
          callback(undefined, newValue);
        } else if (newValue != oldValue) {
          that.log.debug(
            'INFO - refreshDoor - ' +
              service.controlService.subtype +
              ' updating characteristics to : ' +
              that.getStateString(newValue)
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
      }
    });
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
      if (statuserror || !IsJsonString(statusbody)) {
        that.log('ERROR - refreshSensor -  failed');

        if (statuserror) {
          that.handleError(statuserror);
        } else {
          that.log('ERROR - refreshSensor -  no JSON body : ' + statusbody);
          that.handleError(statusbody);
        }

        if (callback) callback(undefined, undefined);
      } else {
        that.log.debug('INFO - refreshSensor with body  : ' + statusbody);

        let res = JSON.parse(statusbody);

        let newVal;
        if (type == BATTERY_SENSOR) {
          newVal = res[1];
          that.log.debug('INFO - refreshBattery with value  : ' + newVal);

          if (newVal == 'full') {
            newVal = 100;
          } else if (newVal == 'low') {
            newVal = 0;
          }
        } else {
          newVal = res[0] / 1000;
          that.log.debug('INFO - refreshTemp with value  : ' + newVal);
        }

        if (callback) {
          callback(undefined, newVal);
        } else {
          if (type == BATTERY_SENSOR) {
            service.controlService
              .getCharacteristic(Characteristic.BatteryLevel)
              .updateValue(newVal);
          } else {
            service.controlService
              .getCharacteristic(Characteristic.CurrentTemperature)
              .updateValue(newVal);
          }
        }
      }
    });
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
        that.log('ERROR - activateDoor - ERROR while sending command');
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

  bindCharacteristicEvents: function(
    characteristic,
    service,
    homebridgeAccessory
  ) {
    if (characteristic instanceof Characteristic.CurrentDoorState) {
      characteristic.on(
        'get',
        function(callback) {
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
        }.bind(this)
      );
    } else if (characteristic instanceof Characteristic.TargetDoorState) {
      characteristic.on(
        'get',
        function(callback) {
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
        }.bind(this)
      );

      characteristic.on(
        'set',
        function(value, callback, context) {
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
                  that.beginDoorOperation(homebridgeAccessory, service, value);

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
        }.bind(this)
      );
    } else if (characteristic instanceof Characteristic.ObstructionDetected) {
      characteristic.on(
        'get',
        function(callback) {
          callback(undefined, false);
        }.bind(this)
      );
    } else if (characteristic instanceof Characteristic.CurrentTemperature) {
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
    } else if (characteristic instanceof Characteristic.BatteryLevel) {
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
    } else if (characteristic instanceof Characteristic.ChargingState) {
      characteristic.on(
        'get',
        function(callback) {
          callback(undefined, false);
        }.bind(this)
      );
    } else if (characteristic instanceof Characteristic.StatusLowBattery) {
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
    }
  },

  beginDoorOperation(myGogogateAccessory, service, state) {
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
