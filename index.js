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
  this.refreshTimerDuringOperartion = config['refreshTimerDuringOperartion'];

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
    this.refreshTimerDuringOperartion == undefined ||
    (this.refreshTimerDuringOperartion < 2 ||
      this.refreshTimerDuringOperartion > 15)
  )
    this.refreshTimerDuringOperartion = 10;

  this.doors = [];
  request = request.defaults({jar: true});

  this.log('init');

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
        that.log('shutdown');
        that.logout(success => {
          if (success) {
            that.log('log out');
          } else {
            that.log('Can not login');
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

    // if we have a login error, try to reconnect
    if (statuserror.includes('ECONNREFUSED')) {
      this.log('handleError - Connection refused, trying to reconnect');
      this.logout(noerror => {
        this.login(success => {
          if (success) {
            this.log('handleError - Reconnection is ok');
          }
        });
      });
    }
    // check for network connectivity
    else if (
      statuterror.includes('ENETUNREACH') ||
      statuterror.includes('EHOSTUNREACH')
    ) {
      this.log(
        'handleError - No network connectivity, check gogogate accessibility'
      );
    }
    //else print error
    else if (statuterror.includes('ETIMEDOUT')) {
      this.log(
        'handleError - timeout connecting to gogogate, check gogogate connectivity'
      );
    }
  },

  refreshBackground(myGogogateAccessory) {
    //timer for background refresh
    if (this.refreshTimer !== undefined && this.refreshTimer > 0) {
      this.log.debug(
        'Setting Timer for background refresh every  : ' +
          this.refreshTimer +
          's'
      );
      this.timerID = setInterval(
        () => this.refreshAllDoors(myGogogateAccessory),
        this.refreshTimer * 1000
      );
    }
  },

  accessories: function(callback) {
    var foundAccessories = [];

    var that = this;
    this.login(success => {
      if (success) {
        this.getDoors(successDoors => {
          if (successDoors) {
            var services = [];

            for (var i = 0, len = this.doors.length; i < len; i++) {
              var doorName = this.doors[i];

              if (doorName && !doorName.isEmpty()) {
                if (this.devMode) {
                  doorName = 'DEV' + doorName;
                }
                this.log('Discovered door : ' + doorName);

                var service = {
                  controlService: new Service.GarageDoorOpener(doorName),
                  characteristics: [
                    Characteristic.CurrentDoorState,
                    Characteristic.TargetDoorState,
                    Characteristic.ObstructionDetected,
                  ],
                };
                service.controlService.subtype = doorName;
                service.controlService.id = i + 1;
                service.id = doorName;
                services.push(service);
              }
            }

            var myGogogateAccessory = new Gogogate2Accessory(services);
            myGogogateAccessory.getServices = function() {
              return that.getServices(myGogogateAccessory);
            };
            myGogogateAccessory.platform = that;
            myGogogateAccessory.name = that.name;
            myGogogateAccessory.model = 'Gogogate2';
            myGogogateAccessory.manufacturer = 'Gogogate';
            myGogogateAccessory.serialNumber = that.gogogateIP;
            foundAccessories.push(myGogogateAccessory);

            //timer for background refresh
            this.refreshBackground(myGogogateAccessory);

            callback(foundAccessories);
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
    var formData = {
      login: this.username,
      pass: this.password,
      'sesion-abierta': '1',
      'send-login': 'submit',
    };
    var baseURL = 'http://' + this.gogogateIP + '/index.php';

    var that = this;
    that.log.debug('LOGIN - trying to log');

    request.post({url: baseURL, formData: formData}, function optionalCallback(
      loginerr,
      loginResponse,
      loginbody
    ) {
      if (loginerr) {
        that.log('LOGIN - login failed:', loginerr);
        callback(false);
      } else if (loginbody && loginbody.includes('Wrong login or password')) {
        that.log('LOGIN - Wrong login or password');
        callback(false);
      } else {
        that.log.debug('LOGIN - login ok');
        callback(true);
      }
    });
  },

  logout: function(callback) {
    var formData = {
      logout: 'submit',
    };
    var baseURL = 'http://' + this.gogogateIP + '/index.php';

    var that = this;
    that.log.debug('Logout - trying to logout');

    request.post({url: baseURL, formData: formData}, function optionalCallback(
      logouterr,
      logoutResponse,
      logoutbody
    ) {
      if (logouterr) {
        that.log('LOGOUT - logout failed at shutdown :', logouterr);
        callback(false);
      } else {
        callback(true);
      }
    });
  },

  getDoors: function(callback) {
    var infoURL =
      'http://' + this.gogogateIP + '/index.php?op=config&opc=doors';

    var that = this;

    request(infoURL, function optionalCallback(
      statuserror,
      statusresponse,
      statusbody
    ) {
      if (statuserror) {
        that.log('getDoors - Can not retrieve doors');
        callback(false);
      } else {
        that.doors = [
          $('input[name="dname1"]', '#config-door1', statusbody).val(),
          $('input[name="dname2"]', '#config-door2', statusbody).val(),
          $('input[name="dname3"]', '#config-door3', statusbody).val(),
        ];
        that.log.debug('DOORS NAMES found : ' + that.doors);
        callback(true);
      }
    });
  },

  refreshAllDoors: function(myGogogateAccessory) {
    for (var s = 0; s < myGogogateAccessory.services.length; s++) {
      var service = myGogogateAccessory.services[s];
      this.log.debug(
        'refreshAllDoors - Door : ' + service.controlService.subtype
      );
      this.refreshDoor(myGogogateAccessory, service);
    }
  },

  refreshDoor: function(myGogogateAccessory, service, callback) {
    var that = this;

    var infoURL =
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
          'refreshDoor - Refreshing status for ' +
            service.controlService.subtype +
            ' Door failed:'
        );
        that.handleError(statuserror);

        if (callback) callback(undefined, undefined);
      } else {
        that.log.debug(
          'refreshDoor - Got Status for : ' +
            service.controlService.subtype +
            ' - ' +
            statusbody +
            '. ServiceTargetState is ' +
            that.getStateString(service.TargetDoorState)
        );

        //timeout
        if (
          service.TargetDoorState !== undefined &&
          Date.now() - service.TargetDoorStateOperationStart >
            that.maxWaitTimeForOperation * 1000
        ) {
          //operation has timedout
          that.endDoorOperation(myGogogateAccessory, service);
          that.log.debug(
            'refreshDoor - ' +
              service.controlService.subtype +
              ' - operation was in progress and  has timedout'
          );
        }

        var oldValue = service.controlService.getCharacteristic(
          Characteristic.CurrentDoorState
        ).value;

        var newValue = undefined;

        that.log.debug(
          'refreshDoor - Current Door State ' + that.getStateString(oldValue)
        );

        if (statusbody == 'OK') {
          if (
            service.TargetDoorState !== undefined &&
            service.TargetDoorState == Characteristic.CurrentDoorState.OPEN
          ) {
            that.endDoorOperation(myGogogateAccessory, service);
            newValue = Characteristic.CurrentDoorState.OPEN;
            that.log.debug(
              'refreshDoor - ' +
                service.controlService.subtype +
                ' - OPENING operation was in progress and is achieved: ' +
                that.getStateString(newValue)
            );
          } else if (service.TargetDoorState == undefined) {
            //no operation in progress, we retrieve the real state
            newValue = Characteristic.CurrentDoorState.OPEN;
            that.log.debug(
              'refreshDoor  - ' +
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
              'refreshDoor - ' +
                service.controlService.subtype +
                ' - CLOSED operation was in progress and is achieved ' +
                that.getStateString(newValue)
            );
          } else if (service.TargetDoorState == undefined) {
            //no operation in progress, we retrieve the real state
            newValue = Characteristic.CurrentDoorState.CLOSED;
            that.log.debug(
              'refreshDoor - ' +
                service.controlService.subtype +
                ' - no operation in progress, we retrieve the real state ' +
                that.getStateString(newValue)
            );
          }
        }

        if (newValue == undefined) {
          that.log.debug(
            'refreshDoor - ' + service.controlService.subtype + ' No new value'
          );
          newValue = oldValue;
        }

        if (callback) {
          that.log.debug(
            'refreshDoor - ' +
              service.controlService.subtype +
              ' calling callback with value : ' +
              that.getStateString(newValue)
          );
          callback(undefined, newValue);
        } else {
          that.log.debug(
            'refreshDoor - ' +
              service.controlService.subtype +
              ' updating characteristics to : ' +
              that.getStateString(newValue)
          );

          service.controlService
            .getCharacteristic(Characteristic.CurrentDoorState)
            .updateValue(newValue);

          service.controlService
            .getCharacteristic(Characteristic.TargetDoorState)
            .updateValue(newValue);
        }
      }
    });
  },

  activateDoor: function(controlService, callback) {
    var commandURL =
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
        that.log('activateDoor - ERROR while sending command');
        that.handleError(statuserror);

        callback(true);
      } else {
        that.debug('activateDoor - Command sent to ' + controlService.subtype);
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
              'GET Characteristic.CurrentDoorState - ' +
                service.controlService.subtype +
                ' - OPENING'
            );
            callback(undefined, Characteristic.CurrentDoorState.OPENING);
          } else if (
            service.TargetDoorState &&
            service.TargetDoorState == Characteristic.TargetDoorState.CLOSED
          ) {
            this.log.debug(
              'GET Characteristic.CurrentDoorState - ' +
                service.controlService.subtype +
                ' - CLOSING'
            );
            callback(undefined, Characteristic.CurrentDoorState.CLOSING);
          } else {
            this.log.debug(
              'GET Characteristic.CurrentDoorState - ' +
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
              'GET Characteristic.TargetDoorState - ' +
                service.controlService.subtype +
                ' - callback with state : ' +
                this.getStateString(service.TargetDoorState)
            );

            callback(undefined, service.TargetDoorState);
          } else {
            this.log.debug(
              'GET Characteristic.TargetDoorState - ' +
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

          if (
            currentState != value &&
            (currentState == Characteristic.CurrentDoorState.OPEN ||
              currentState == Characteristic.CurrentDoorState.CLOSED)
          ) {
            this.log.debug(
              'SET Characteristic.TargetDoorState - ' +
                service.controlService.subtype +
                ' - CurrentDoorState is ' +
                this.getStateString(currentState)
            );

            var that = this;

            homebridgeAccessory.platform.activateDoor(
              service.controlService,
              function(error) {
                if (error) {
                  that.endDoorOperation(homebridgeAccessory, service);
                  characteristic.updateValue(currentValue);
                  that.log.debug(
                    'SET Characteristic.TargetDoorState - ' +
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
                    'SET Characteristic.TargetDoorState - ' +
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
      'beginDoorOperation - ' +
        service.controlService.subtype +
        ' - Setting Timer for operation'
    );

    this.timerID = setInterval(() => {
      this.refreshAllDoors(myGogogateAccessory);
    }, this.refreshTimerDuringOperartion * 1000);
  },

  endDoorOperation(myGogogateAccessory, service) {
    //stop timer for this operation
    this.log.debug(
      'endDoorOperation - ' +
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
      var operationInProgress = false;
      for (var s = 0; s < myGogogateAccessory.services.length; s++) {
        var service = myGogogateAccessory.services[s];
        if (service.TargetDoorStateOperationStart) {
          operationInProgress = true;
          break;
        }
      }

      if (!operationInProgress) {
        clearInterval(this.timerID);
        this.timerID = undefined;
        this.refreshBackground(myGogogateAccessory);
      }
    }
  },

  getInformationService: function(homebridgeAccessory) {
    var informationService = new Service.AccessoryInformation();
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
    var services = [];
    var informationService = homebridgeAccessory.platform.getInformationService(
      homebridgeAccessory
    );
    services.push(informationService);
    for (var s = 0; s < homebridgeAccessory.services.length; s++) {
      var service = homebridgeAccessory.services[s];
      for (var i = 0; i < service.characteristics.length; i++) {
        var characteristic = service.controlService.getCharacteristic(
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
