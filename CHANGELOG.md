# Changelog

All notable changes to this project will be documented in this file.

## 1.1.3

- [NEW] funding link

## 1.1.2

- [FIX] reset targetState at startup just in case
- [NEW] cleaning lost devices from cache

## 1.1.1

- [NEW] minor improvment in opening / closing process.

## 1.1.0

- [NEW] event based logic for faster refresh, speed improvments.

## 1.0.7

- Bump dep versions for homebridge verified plugin process

## 1.0.6

- [NEW] Supports config UI X configuration interface.

## 1.0.5

- [FIX] fixed some logs

## 1.0.4

- [FIX] #33 Status is not correct until refresh timer if door operated outside app

## 1.0.3

- [FIX] #32 Operation timer is canceled before all operations completed if more than one dorr is operated simultaneously

## 1.0.2

- [FIX] #31 Door might be stuck to opening or closing

## 1.0.1

- [FIX] #13 : door can switch to closing while opening

## 1.0.0

- [FIX] #4 : switch to dynamic platform mode

## 0.1.5

- [FIX] trying to work on #20 issue

## 0.1.4

- [NEW] huge refactoring to enhance code quality (I hope there won't be too much bugs ! )

## 0.1.3

- [FIX] handle json parse error for sensor #14, new attempt (one more) !

## 0.1.2

- [FIX] handle json parse error for sensor #14, new attempt !

## 0.1.1

- [FIX] handle json parse error for sensor #14

## 0.1.0

- [BREAKING] renamed refreshTimerDuringOperartion option to refreshTimerDuringOperation
- [FIX] While opening, door might switch from opening to closing in home app before completion of operation #13

## 0.0.9

- [FIX] crash with multiple doors #11
- [FIX] temperature sensor for all sensors #12

## 0.0.8

- [NEW] temp sensor and battery level of garage door sensor on doors which have one .
- [NEW] moving each door as an accessory - You might need to empty your cache folder .

## 0.0.7

- [FIX] crash on error

## 0.0.5

- [FIX] crash homebridge when activating door

## 0.0.4

- [FIX] Prevent loosing doors if error at homebridge startup (can't login / gogogate unreachable).

## 0.0.3

- [NEW] New optionnal option for state refresh timer during operation of doors.
- [FIX] handling login error.

## 0.0.2

- [NEW] Update and fixes

## 0.0.1

- [NEW] First version
