module.exports = {
  IsJsonString: function (str) {
    try {
      JSON.parse(str);
    } catch (e) {
      return false;
    }
    return true;
  },

  checkTimer: function (timer) {
    if (timer && timer > 0 && (timer < 30 || timer > 600)) return 180;
    else return timer;
  },

  checkParemeter: function (parameter, min, max, def) {
    if (parameter == undefined || parameter < min || parameter > max) return def;
    else return parameter;
  },

  normalizeBattery: function (val) {
    if (val == 'full') {
      return 100;
    } else if (val == 'low') {
      return 0;
    } else {
      return val;
    }
  },
};
