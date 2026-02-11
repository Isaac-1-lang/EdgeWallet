# Hardware Setup Guide

## Components Required
1. **ESP8266** (NodeMCU or Wemos D1 Mini)
2. **MFRC522** RFID Reader Module
3. Jumper Wires
4. Breadboard

## Wiring (ESP8266 to RC522)

| RC522 Pin | ESP8266 Pin (NodeMCU) | GPIO | Function |
|-----------|-----------------------|------|----------|
| SDA (SS)  | D4                    | 2    | Chip Select |
| SCK       | D5                    | 14   | SPI Clock |
| MOSI      | D7                    | 13   | SPI MOSI |
| MISO      | D6                    | 12   | SPI MISO |
| IRQ       | N/C                   | -    | Not Connected |
| GND       | GND                   | -    | Ground |
| RST       | D3                    | 0    | Reset |
| 3.3V      | 3.3V                  | -    | Power |

> **Note:** Do NOT connect 3.3V to 5V (Vin). The RC522 module requires 3.3V.

## Flashing Instructions

1.  **Install MicroPython**:
    - Download ESP8266 MicroPython binary from [micropython.org](https://micropython.org/download/esp8266/).
    - Flash using `esptool`:
      ```bash
      esptool.py --port COMx erase_flash
      esptool.py --port COMx --baud 460800 write_flash --flash_size=detect 0 esp8266-xxxx.bin
      ```

2.  **Upload Files**:
    - Use **Thonny IDE** or `ampy`.
    - Upload all files in the `firmware/` folder:
        - `config.py`
        - `mfrc522.py`
        - `wifi_connect.py`
        - `main.py`

3.  **Run**:
    - Press the Reset button on the ESP8266.
    - Open the Serial Monitor (115200 baud) to see logs.

## Usage
1.  **Read Card**: Tap an RFID card. The UID and Balance will be printed/published.
2.  **Top Up**: Send a `Top-up` command from the Dashboard. Tap the card again to apply the balance update.
