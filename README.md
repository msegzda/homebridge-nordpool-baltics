# Homebridge Nordpool LT, LV, EE, FI Plugin #

By integrating the plugin, you can automate your electricity-intensive appliances or devices such as boilers, heating systems, car charging, or house power-walls according to Nordpool's price levels.

It supports the following Nordpool areas only: Lithuania, Latvia, Estonia, and Finland

## Exposed Accessories ##

The plugin exposes a variety of accessories that allow for versatile HomeKit automations based on Nordpool prices. These include:

1. **Nordpool_hourlyTickerSwitch**: A switch that cycles ON and OFF every hour. Use it in 'An Accessory is Controlled' event on Homekit automation. Then check for desired price/levels further on automation logic;

1. **Nordpool_currentPrice**: A Light Sensor indicating the current hour's electricity price in Euro cents. Scale: 1 LUX = 1 cent;

1. **Nordpool_cheapestHour**: Motion Sensor goes into 'motion detected' state if current hour electricity price ranks cheapest in the day. There can be more than one cheapest hours in case cheapest price repeats more than once;

1. **Nordpool_cheapest4Hours** to **Nordpool_cheapest8Hours**: A series of Motion Sensors which trigger a 'motion detected' state when the current hour's electricity price ranks among the cheapest of the day. The count can exceed the specified number in the event of repeated same-price occurrences during the day;

1. **Nordpool_priciestHour**: A Motion Sensor which triggers 'motion detected' when the current hour's electricity price is the most expensive of the day. More than one hour may qualify if highest price repeats;

## Important Remarks ##

Homebridge system (host) timezone must match chosen Nordpool area's timezone.

## Homekit Automation Examples ##

For robust application of the Nordpool plugin, here are a few advanced automation examples, based on real-life use cases.

TBC
