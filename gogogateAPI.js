var request = require('request');
const $ = require('cheerio');
const GogogateTools = require('./gogogateTools.js');

var EventEmitter = require('events');
var inherits = require('util').inherits;

module.exports = {
  GogogateAPI: GogogateAPI,
};

function GogogateAPI(log, platform) {
  EventEmitter.call(this);

  this.log = log;
  this.platform = platform;
  this.gogogateIP = platform.gogogateIP;
  this.username = platform.username;
  this.password = platform.password;
  this.discoverdDoors = [];
  this.discoverdSensors = [];
  request = request.defaults({jar: true});
}

function isLoginError(statuserror) {
  return (
    (statuserror && statuserror.code && statuserror.code.includes('ECONNREFUSED')) ||
    (statuserror &&
      (typeof statuserror === 'string' || statuserror instanceof String) &&
      statuserror.includes('Restricted Access'))
  );
}

function isNetworkError(statuserror) {
  return (
    statuserror &&
    (statuserror.code.includes('ENETUNREACH') || statuserror.code.includes('EHOSTUNREACH'))
  );
}

function isTimeoutError(statuserror) {
  return statuserror && statuserror.code.includes('ETIMEDOUT');
}

GogogateAPI.prototype = {
  getStateString: function (state) {
    if (state == 0) return 'OPEN';
    else if (state == 1) return 'CLOSED';
    else if (state == 2) return 'OPENING';
    else if (state == 3) return 'CLOSING';
    else if (state == 4) return 'STOPPED';
  },

  handleError: function (statuserror) {
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
    if (isLoginError(statuserror)) {
      this.log('WARNING - handleError - Connection refused, trying to reconnect');
      this.logout(() => {
        this.login((success) => {
          if (success) {
            this.log('INFO - handleError - Reconnection is ok');
          }
        });
      });
    }
    // check for network connectivity
    else if (isNetworkError(statuserror)) {
      //Try to send a WOL ?
      this.log('ERROR - handleError - No network connectivity, check gogogate accessibility');
    }
    //else print error
    else if (isTimeoutError(statuserror)) {
      //Try to send a WOL ?
      this.log('ERROR - handleError - timeout connecting to gogogate, check gogogate connectivity');
    }
  },

  login: function (callback) {
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

  logout: function (callback) {
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

  getDoors: function () {
    this.login((success) => {
      if (success) {
        let infoURL = 'http://' + this.gogogateIP + '/index.php?op=config&opc=doors';

        var that = this;

        request(infoURL, function optionalCallback(statuserror, statusresponse, statusbody) {
          if (statuserror) {
            that.log('ERROR - getDoors - Can not retrieve doors');
            that.emit('doorsRetrieveError');
          } else {
            that.discoverdDoors = [
              $('input[name="dname1"]', '#config-door1', statusbody).val(),
              $('input[name="dname2"]', '#config-door2', statusbody).val(),
              $('input[name="dname3"]', '#config-door3', statusbody).val(),
            ];
            that.discoverdSensors = [
              $('input[name="door1"]', '#config-door1', statusbody).val(),
              $('input[name="door2"]', '#config-door2', statusbody).val(),
              $('input[name="door3"]', '#config-door3', statusbody).val(),
            ];
            that.log.debug('INFO - DOORS NAMES found : ' + that.discoverdDoors);
            that.log.debug('INFO - SENSORS NAMES found : ' + that.discoverdSensors);

            that.emit('doorsRetrieved');
          }
        });
      } else {
        that.emit('doorsRetrieveError');
      }
    });
  },

  refreshDoor: function (gateId) {
    var that = this;

    let infoURL = 'http://' + this.gogogateIP + '/isg/statusDoor.php?numdoor=' + gateId;

    request(infoURL, function optionalCallback(statuserror, statusresponse, statusbody) {
      that.log.debug(
        'INFO - statusbody : *' +
          statusbody +
          '* - statusresponse : ' +
          JSON.stringify(statusresponse)
      );

      if (statuserror) {
        that.log(
          'ERROR - refreshDoor - Refreshing status failed - ' + JSON.stringify(statusresponse)
        );
        that.handleError(statuserror);
        that.emit('doorRefreshError', gateId);
      } else {
        that.emit('doorRefreshed', gateId, statusbody);
      }
    });
  },

  refreshSensor: function (gateId) {
    var that = this;

    let infoURL = 'http://' + this.gogogateIP + '/isg/temperature.php?door=' + gateId;

    request(infoURL, function optionalCallback(statuserror, statusresponse, statusbody) {
      if (statuserror) {
        that.log('ERROR - refreshSensor -  failed');
        that.handleError(statuserror);
        that.emit('sensorRefreshError', gateId);
      } else if (!GogogateTools.IsJsonString(statusbody)) {
        that.log(
          'ERROR - refreshSensor -  failed - no JSON body -' +
            statusbody +
            '-' +
            JSON.stringify(statusresponse)
        );
        that.handleError(statusbody);
        that.emit('sensorRefreshError', gateId);
      } else {
        that.emit('sensorRefreshed', gateId, statusbody);
      }
    });
  },

  activateDoor: function (gateId, callback) {
    let commandURL = 'http://' + this.gogogateIP + '/isg/opendoor.php?numdoor=' + gateId;

    var that = this;

    request(commandURL, function optionalCallback(statuserror, statusresponse, statusbody) {
      if (statuserror) {
        that.log(
          'ERROR - activateDoor - ERROR while sending command -' +
            statusbody +
            '-' +
            JSON.stringify(statusresponse)
        );
        that.handleError(statuserror);

        callback(true);
      } else {
        that.log.debug('INFO - activateDoor - Command sent');
        callback(false);
      }
    });
  },
};

inherits(GogogateAPI, EventEmitter);
