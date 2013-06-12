What's Lounge?
================

Lounge is a website for organising gg2 games. Live at http://lounge.ajf.me/

(forked from lunasync...)

Setup
-----

1. `npm install`

2. Configure `server/config.json`. Unless you're ajf, keep `useInternalServer` as `true`. Set `debugOrigin` and `origin` to the hostnames of the places you'll be hosting Lounge on. Here's a default config.json:

    {
        "useInternalServer": true,
        "debugOrigin": "http://localhost:8000",
        "origin": "http://lounge.ajf.me"
    }

3. Run `node server.js` on the same hostname. (Add the `--debug` flag when debugging to ignore request origins).

4. That's it, I think?

Notes
-----

If you type the letter `u` when running the server, it will kick all the clients off for updating and shut down. The clients should reconnect after 5 seconds.
