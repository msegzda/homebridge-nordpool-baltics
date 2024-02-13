# Homebridge Nordpool LT, LV, EE, FI Plugin #

This plugin allows to automate your electricity-intensive appliances and devices such as boiler, heating system, car charging, or house power-wall according to Nordpool's price levels.

It supports the following Nordpool areas only: Lithuania, Latvia, Estonia, and Finland

## Exposed Accessories ##

It exposes a few 'fake' accessories that facilitates versatile HomeKit automation based on Nordpool prices. These include:

1. **Nordpool_hourlyTickerSwitch**: A switch that cycles ON and OFF every hour. Use it in 'An Accessory is Controlled' event on HomeKit automation. Then check for desired price/levels further on automation logic;

1. **Nordpool_currentPrice**: A Light Sensor indicating the current hour's electricity price in Euro cents. Scale: 1 LUX = 1 cent;

1. **Nordpool_cheapestHour**: Motion Sensor goes into 'motion detected' state if current hour electricity price ranks cheapest in the day. There can be more than one cheapest hours in the event of repeated same-price occurrences;

1. **Nordpool_cheapest4Hours** to **Nordpool_cheapest8Hours**: A series of Motion Sensors which trigger a 'motion detected' state when the current hour's electricity price ranks among the cheapest of the day. The count can exceed the specified number in the event of repeated same-price occurrences;

1. **Nordpool_cheapest5HoursConsec**: This Motion Sensor triggers during the 5 consecutive lowest-priced electricity hours of the day, ensuring energy-intensive appliances operate uninterrupted for a stretch of 5 hours at the most cost-effective rate;

1. **Nordpool_priciestHour**: A Motion Sensor which triggers 'motion detected' when the current hour's electricity price is the most expensive of the day or exceeds configurable median margin (default 200%). This is typically more than one hour during the day.

## Important Remarks ##

Homebridge system (host) timezone must match chosen Nordpool area's timezone.

## HomeKit Automation Examples ##

For robust application of the Nordpool plugin, here are a few advanced automation examples, based on real-life use cases.

TBC
