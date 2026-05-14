import got from 'got';
import {CookieJar} from 'tough-cookie';
import * as Cheerio from 'cheerio';
import * as GogogateTools from './gogogateTools.js';
import {EventEmitter} from 'events';
import {inherits} from 'util';

export {GogogateAPI};

function GogogateAPI(log, platform) {
  EventEmitter.call(this);

  this.log = log;
  this.platform = platform;
  this.gogogateIP = platform.gogogateIP;
  this.username = platform.username;
  this.password = platform.password;
  this.discoverdDoors = [];
  this.discoverdSensors = [];

  // Create instance-specific cookie jar for persistent sessions
  const cookieJar = new CookieJar();
  this.request = got.extend({cookieJar, throwHttpErrors: false, responseType: 'text'});
}

function safeStringify(value) {
  const seen = new WeakSet();
  return JSON.stringify(
    value,
    (key, val) => {
      if (typeof val === 'object' && val !== null) {
        if (seen.has(val)) return '[Circular]';
        seen.add(val);
      }
      return val;
    },
    2
  );
}

function isLoginError(statuserror) {
  const code = statuserror?.code;
  return (
    (typeof code === 'string' && code.includes('ECONNREFUSED')) ||
    (typeof statuserror === 'string' && statuserror.includes('Restricted Access'))
  );
}

function isNetworkError(statuserror) {
  const code = statuserror?.code;
  return (
    typeof code === 'string' && (code.includes('ENETUNREACH') || code.includes('EHOSTUNREACH'))
  );
}

function isTimeoutError(statuserror) {
  return typeof statuserror?.code === 'string' && statuserror.code.includes('ETIMEDOUT');
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

    that.request
      .post(baseURL, {form: formData})
      .then((response) => {
        const loginbody = response.body;
        if (loginbody && loginbody.includes('Wrong login or password')) {
          that.log('ERROR - LOGIN - Wrong login or password');
          callback(false);
        } else {
          that.log.debug('INFO - LOGIN - login ok');
          callback(true);
        }
      })
      .catch((loginerr) => {
        that.log('ERROR - LOGIN - login failed:', loginerr);
        callback(false);
      });
  },

  logout: function (callback) {
    let formData = {
      logout: 'submit',
    };
    let baseURL = 'http://' + this.gogogateIP + '/index.php';

    var that = this;

    that.log.debug('INFO - Logout - trying to logout');

    that.request
      .post(baseURL, {form: formData})
      .then(() => {
        callback(true);
      })
      .catch((logouterr) => {
        that.log('ERROR - LOGOUT - logout failed :', logouterr);
        callback(false);
      });
  },

  getDoors: function () {
    this.login((success) => {
      if (success) {
        let infoURL = 'http://' + this.gogogateIP + '/index.php?op=config&opc=doors';

        var that = this;

        that
          .request(infoURL)
          .then((response) => {
            const statusbody = response.body;
            var data = Cheerio.load(statusbody);

            that.discoverdDoors = [
              data('input[name="dname1"]', '#config-door1').val(),
              data('input[name="dname2"]', '#config-door2').val(),
              data('input[name="dname3"]', '#config-door3').val(),
            ];
            that.discoverdSensors = [
              data('input[name="door1"]', '#config-door1').val(),
              data('input[name="door2"]', '#config-door2').val(),
              data('input[name="door3"]', '#config-door3').val(),
            ];
            that.log.debug('INFO - DOORS NAMES found : ' + that.discoverdDoors);
            that.log.debug('INFO - SENSORS NAMES found : ' + that.discoverdSensors);

            that.emit('doorsRetrieved');
          })
          .catch(() => {
            that.log('ERROR - getDoors - Can not retrieve doors');
            that.emit('doorsRetrieveError');
          });
      } else {
        that.emit('doorsRetrieveError');
      }
    });
  },

  refreshDoor: function (gateId) {
    var that = this;

    let infoURL = 'http://' + this.gogogateIP + '/isg/statusDoor.php?numdoor=' + gateId;

    that
      .request(infoURL)
      .then((response) => {
        const statusbody = response.body;
        that.log.debug(
          'INFO - statusbody : *' + statusbody + '* - statusCode : ' + response.statusCode
        );
        that.emit('doorRefreshed', gateId, statusbody);
      })
      .catch((statuserror) => {
        that.log('ERROR - refreshDoor - Refreshing status failed - ' + safeStringify(statuserror));
        that.handleError(statuserror);
        that.emit('doorRefreshError', gateId);
      });
  },

  refreshSensor: function (gateId) {
    var that = this;

    let infoURL = 'http://' + this.gogogateIP + '/isg/temperature.php?door=' + gateId;

    that
      .request(infoURL)
      .then((response) => {
        const statusbody = response.body;
        if (!GogogateTools.IsJsonString(statusbody)) {
          that.log(
            'ERROR - refreshSensor -  failed - no JSON body -' +
              statusbody +
              ' - statusCode: ' +
              response.statusCode
          );
          that.handleError(statusbody);
          that.emit('sensorRefreshError', gateId);
        } else {
          that.emit('sensorRefreshed', gateId, statusbody);
        }
      })
      .catch((statuserror) => {
        that.log('ERROR - refreshSensor -  failed');
        that.handleError(statuserror);
        that.emit('sensorRefreshError', gateId);
      });
  },

  activateDoor: function (gateId, callback) {
    let commandURL = 'http://' + this.gogogateIP + '/isg/opendoor.php?numdoor=' + gateId;

    var that = this;

    that
      .request(commandURL)
      .then(() => {
        that.log.debug('INFO - activateDoor - Command sent');
        callback(false);
      })
      .catch((statuserror) => {
        that.log(
          'ERROR - activateDoor - ERROR while sending command -' + safeStringify(statuserror)
        );
        that.handleError(statuserror);

        callback(true);
      });
  },
};

inherits(GogogateAPI, EventEmitter);
