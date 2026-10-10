# MeshSense Next

**MeshSense Next** is based on [MeshSense](https://github.com/Affirmatech/MeshSense) by Affirmatech. It is a simple, open-source application that monitors, maps and graphically displays all the vital stats of your area's Meshtastic network including connected nodes, signal reports, trace routes and more!

![](https://affirmatech.com/meshsense.png)

MeshSense directly connects to your Meshtastic node via Bluetooth or WiFi and continuously provides all the information you need to assess the health of your network. For more detailed information, take a peek at our [Frequently Asked Questions](https://affirmatech.com/meshsense/faq) or [Bluetooth Tips](https://affirmatech.com/meshsense/bluetooth).

## Headless Usage

To run MeshSense Next without a GUI, use the `--headless` flag. Additionally the `ACCESS_KEY` environment variable can be used to specify the privileged access key for remote connections to gain full permissions.

```sh
export ADDRESS=10.0.1.20  # Address of Meshtastic Node
export PORT=5920          # Port of remote interface

ACCESS_KEY=mySecretKey ./meshsense-x86_64.AppImage --headless

# Alternative execution:
dbus-run-session xvfb-run ./meshsense-arm64.AppImage --headless \
 --disable-gpu --in-process-gpu --disable-software-rasterizer
```

See also [Headless FAQ](https://affirmatech.com/meshsense/faq#headless)

## Run at boot (Linux, Raspberry Pi)

After building from source (see Development Setup), MeshSense Next can run as a systemd service without Electron: the API serves the web UI on port 5920 and connects to the node on startup.

```sh
sudo deploy/install-service.sh        # installs and starts meshsense-next.service as the current user
journalctl -u meshsense-next -f       # follow the log
```

Settings, the access key and the node address are kept in `/var/lib/meshsense-next/meshsense` and are changed through the web UI. The unit file is `deploy/meshsense-next.service`; run the script again after a rebuild to restart the service.

## Debian Dependencies

Ubuntu and Raspberry Pi OS users will need the following dependency installed to run the AppImage:

```sh
sudo apt install libfuse2
```

To display unicode symbols on the buttons, it may be helpful to install `fonts-noto-color-emoji`

```sh
sudo apt install fonts-noto-color-emoji
```

## Development Setup

To run MeshSense Next from the source code, first clone this repo:

```sh
git clone --recurse-submodules https://github.com/devfilmer/MeshSense-Next.git
cd MeshSense-Next
```

Build `webbluetooth` Dependency.  Debian systems will need the `cmake` and `libdbus-1-dev` packages.

```
cd api/webbluetooth
npm i
npm run build:all
cd ../..
```

The `update.mjs` script will pull the latest code and install dependencies for the `ui`, `api`, and `electron` directories. It also builds the Meshtastic library in `api/meshtastic-js`, which is kept in this repository (protobufs 2.8.0) rather than as a submodule.

```sh
./update.mjs
```

During development, the electron portion is usually not needed. First start the UI Vite service as follows:

```sh
cd ui
PORT=5921 npm run dev
```

Leave the UI running and then also start the API service. The `DEV_UI_URL` will tell the API to forward any unhandled route requests to the UI service and should use the same port as above.

```sh
cd api
export DEV_UI_URL=http://localhost:5921
PORT=5920 npm run dev
```

The `PORT` variables in the above are optional and will default to the values in the example, but ensure `DEV_UI_URL` is present with the correct port if changed. These values may also be read from `.env` files `api/.env` and `ui/.env` respectively.

The front-end should now be accessible by connecting to the **API** service in a browser. Be careful not to connect to the UI service by accident. http://localhost:5920/

Any API changes will automatically reload the service. Any UI changes will be hot-reloaded by Vite.

**Please note:** currently certain event subscribers (particularly State variables) will duplicate their subscription when Vite hot-reloads resulting in duplicate events such as Log entries. Until this is fixed, the easiest solution is to refresh the browser to reset the events.

To build the `ui`, `api`, and `electron` components, the `build.mjs` script will accomplish this. The official electron builds are signed with an Affirmatech certificate on our build servers. The deployables will be placed in `api/dist` and `electron/dist`.
