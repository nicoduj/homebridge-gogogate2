export function IsJsonString(str) {
  try {
    JSON.parse(str);
  } catch (e) {
    return false;
  }
  return true;
}

export function checkTimer(timer) {
  if (timer && timer > 0 && (timer < 30 || timer > 600)) return 180;
  else return timer;
}

export function checkParemeter(parameter, min, max, def) {
  if (parameter == undefined || parameter < min || parameter > max) return def;
  else return parameter;
}

export function normalizeBattery(val) {
  if (val == 'full') {
    return 100;
  } else if (val == 'low') {
    return 0;
  } else {
    return val;
  }
}
