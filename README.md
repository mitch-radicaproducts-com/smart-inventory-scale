# smart-inventory-scale

A Chromebook page for the Seattle Alki SEAKS3011D counting scale (30 kg × 0.5 g). Chrome reads the scale’s RS-232 port with the Web Serial API. No installer is required on the Chromebook.

## Run the page

```bash
npm start
```

Open `http://127.0.0.1:4173` in Chrome. Web Serial is available on localhost and on https. It is not available from a `file://` address.

```bash
npm test
```

## RS-232

The Fristaden Lab counting-scale manual (the SEAKS3011D / HCS3011D family) documents the link as follows.

- Default baud rate is 9600. Press 7, 8, 9 until the display shows `diu`, then PCS/SET until `bud`, and confirm 9600 with Alarm.
- The same menu’s `odE` setting chooses the output. Mode 1 sends when P is pressed. Mode 2 sends once the weight is stable. Mode 3 sends continuously. Turn the scale off and on after changing it.
- The manual’s terminal steps say to enter `R`. They also say to short-press CAL/PCS, which is the print key on the related HC balances. On this model the print key is P.
- A USB-to-RS232 adapter (FTDI is the adapter Fristaden recommends) and a straight DB9 cable connect the scale to the Chromebook. The counting-scale manual does not draw the pins. Fristaden’s other balances use pin 2 to transmit, pin 3 to receive, and pin 5 for ground.
- The same seller’s browser logger and HC-series notes use 8 data bits, no parity, and 1 stop bit. The counting-scale manual names the baud rate and leaves the other parameters unstated, so the page defaults to 8N1 and can switch.

The manual does not publish the print string. The page keeps every received line and fills the weight, piece, and unit-weight cards when a line names one of those values.

## Hardware diagnostic

Connect the adapter, put a weight on the pan, and choose Run diagnostic. The page writes a JSON file of every command it sent and every byte that came back. Send that file back so the print text and command set can be matched to this scale.
