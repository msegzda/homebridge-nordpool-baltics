# homebridge-nordpool-baltics #

[![NPM Version](https://img.shields.io/npm/v/homebridge-nordpool-baltics)](https://www.npmjs.com/package/homebridge-nordpool-baltics/v/latest)
[![GitHub last commit](https://img.shields.io/github/last-commit/msegzda/homebridge-nordpool-baltics.svg)](https://github.com/msegzda/homebridge-nordpool-baltics)
![NPM Build Status](https://img.shields.io/github/actions/workflow/status/msegzda/homebridge-nordpool-baltics/npm-publish.yml)
[![NPM Downloads](https://img.shields.io/npm/dw/homebridge-nordpool-baltics)](https://www.npmjs.com/package/homebridge-nordpool-baltics?activeTab=versions)
![NPM License](https://img.shields.io/npm/l/homebridge-nordpool-baltics)

If your electricity is billed based on hourly rates through a smart meter, this plugin enables you to automate power-intensive appliances in accordance with Nordpool's pricing levels. For example, this could apply to:

- Car charging
- House heating or cooling devices
- Power-wall (to balance electricity costs)
- Washer-dryer
- Water heater (a.k.a boiler)

Currently, this plugin supports the following Nordpool electricity market areas:

- Lithuania
- Latvia
- Estonia
- Finland

## How To Install ##

First, complete the [Homebridge setup](https://homebridge.io/how-to-install-homebridge). Afterwards, the most convenient way to install the `homebridge-nordpool-baltics` plugin is by using the Homebridge Plugins Manager.

## Available Accessories ##

It exposes a few 'virtual' accessories that facilitate versatile HomeKit automation based on Nordpool price levels. These include:

1. `Nordpool_hourlyTickerSwitch`: A switch that cycles ON and OFF every hour. Use it in 'An Accessory is Controlled' event on HomeKit automation. Then check for desired price/levels further on automation logic;

1. `Nordpool_currentPrice`: A Light Sensor representing the current hour's electricity price in Euro cents (1 LUX = 1 cent). Due to HomeKit limitation, the minimal value is 0.0001, even if the actual price is 0 or negative.

1. `Nordpool_cheapestHour`: Motion Sensor goes into 'motion detected' state if current hour electricity price ranks cheapest in the day. There can be more than one cheapest hours in the event of repeated same-price occurrences;

1. `Nordpool_cheapest4Hours` to `Nordpool_cheapest8Hours` (optional on Plugin Config): A series of Motion Sensors which trigger a 'motion detected' state when the current hour's electricity price ranks among the cheapest of the day. The count can exceed the specified number in the event of repeated same-price occurrences;

1. `Nordpool_cheapest5HoursConsec` (optional on Plugin Config): This Motion Sensor triggers during the 5 consecutive lowest-priced electricity hours ensuring energy-intensive appliances can operate uninterrupted for a stretch of 5 hours. Note more details about its [calculation below](#cheapest-consecutive-hours-calculation-logic).

1. `Nordpool_priciestHour`: This Motion Sensor triggers 'motion detected' when **any** of the following is true:
    - Current hour price is most expensive of the day;
    - Current hour price is within 10% difference from most expensive hour;
    - Current hour price exceeds 'Excessive Price Margin Above Median' value (default 200%).

1. `Nordpool_currentHour` (optional on Plugin Config): Temperature sensor (possible values 0-24) denoting current hour of the day (24h format). Eliminates 'current hour' scripting needed on HomeKit rules.

## HomeKit Automation Examples ##

Here are a few automation examples, based on real-life use cases. Please note, the names of the accessories from the `homebridge-nordpool-baltics` plugin have been renamed to improve readability.

| Water heater | Floor heater | Car charging |
| --------- | --------- | --------- |
| ![Boiler1](images/boiler1.png) | ![Floor1](images/floor1.png)  | ![Car1](images/car1.png)   |
| ![Boiler2](images/boiler2.png)  | ![Floor2](images/floor2.png)  | ![Car2](images/car2.png)  |

Have you devised an ingenious automation making the most out of this plugin? Don't keep it to yourself - [share it using this form](https://github.com/msegzda/homebridge-nordpool-baltics/issues/new)!

## Cheapest Consecutive Hours Calculation Logic ##

Motion sensor `Nordpool_cheapest5HoursConsec` calculation logic is the following:

### If 'Dynamic Cheapest Consecutive Hours' is **Disabled** in Plugin Config ###

- **At 00:00 (midnight)**: Recalculated using the pricing information of the new day.

### If 'Dynamic Cheapest Consecutive Hours' is **Enabled** in Plugin Config ###

- **At 18:00 (6PM)**: If the cheapest 5 consecutive hours occurs later in the evening, the computation includes 0AM-6AM period from the next day. This could potentially *shift* the 5-hour period of cheapest price from the evening to the next day's early morning, aiming for maximum cost efficiency.

- **At 00:00 (midnight)**: If the 6PM run did not result in a *shift*, it will recalculate as normal using the pricing information of the new day.

- **At 07:00 (7AM)**: If the 6PM run *shifted* the 5-hour period, a recalculation happens considering the remaining pricing information of the current day.

## Important Remark About Timezones ##

For accurate hour-to-price matching, it's important that the timezone of your homebridge system (the host) aligns with the timezone of the chosen Nordpool area. If there is a mismatch, the plugin will emit a warning in the log.

Additionally, please verify that your system's clock is regularly synchronized to ensure consistent and accurate hour-to-price ticking.
