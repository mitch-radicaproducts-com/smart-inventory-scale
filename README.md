# smart-inventory-scale

A Chrome page for the Seattle Alki SEAKS3011D counting scale (30 kg × 0.5 g). The scale prints over RS-232. The page listens. It does not send commands.

## Run the page

GitHub Pages publishes `main` at `https://mitch-radicaproducts-com.github.io/smart-inventory-scale/`.

```bash
npm test
npm start
```

Web Serial works on that https address and on `http://127.0.0.1`. It does not work from a `file://` address, and it does not work in Firefox or Safari.

## RS-232

The counting-scale manual documents a receiver, not a command set.

- Default baud rate is 9600. Press 7, 8, 9 until `diu`, then PCS/SET until `bud`, and confirm 9600 with Alarm.
- `odE` chooses the output. Mode 1 sends when P is pressed. Mode 2 sends when the weight is stable. Mode 3 sends continuously. Turn the scale off and on after changing it.
- A USB-to-RS232 adapter connects the scale. The manual does not draw the pins. The same seller’s other balances use pin 2 to transmit, pin 3 to receive, and pin 5 for ground.
- The manual names the baud rate and leaves data bits, parity, and stop bits unstated. The page defaults to 8 data bits, no parity, and 1 stop bit.

A probe of every printable character and the usual read commands returned no bytes. The manual does not publish the print text. The page shows that text as it arrives and fills weight, pieces, or unit weight only when the text names them.

## Tampermonkey

`scale.user.js` types each print into the focused field, then sends Enter when the scale sends a carriage return. Install it in Tampermonkey on Chrome. The first time on a website, click **Connect scale** and choose the adapter. After that, the script reopens that saved adapter by itself when the page loads. Click the field you want, then press P on the scale.

Chrome will not skip the chooser until the site has been allowed once. That permission belongs to the website. Connecting on one site does not cover another. The script runs on the top-level Chrome tab. It does not run inside an Airtable custom-extension frame. Firefox has no Web Serial API, so the script does nothing there.
