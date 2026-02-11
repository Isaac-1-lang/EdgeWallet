# main.py
import time
from machine import Pin, SPI, SoftSPI
from mfrc522 import MFRC522
import wifi_connect
from umqtt.simple import MQTTClient
import json
import config

# --- PINS CONFIGURATION (Wemos D1 Mini / ESP8266) ---
# SCK, MOSI, MISO are on standard SPI pins (GPIO14, GPIO13, GPIO12)
# RST = D3 (GPIO0)
# SDA(SS) = D4 (GPIO2)
# NOTE: Check your physical wiring!
RST_PIN = 0
SS_PIN  = 2
SCK_PIN = 14
MOSI_PIN = 13
MISO_PIN = 12

# --- RFID CONFIGURATION ---
BLOCK_ADDR = 4 # We use Sector 1, Block 4 for storing balance
SECTOR_KEY = [0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF] # Factory Default Key A

# --- GLOBAL VARIABLES ---
pending_topup = 0
last_read_time = 0
READ_DELAY = 1000 # ms

# --- MQTT SETUP ---
def on_message(topic, msg):
    global pending_topup
    print(f"Message received on {topic}: {msg}")
    try:
        topic_str = topic.decode('utf-8')
        payload = json.loads(msg)
        
        if topic_str == config.TOPIC_TOPUP:
            amount = payload.get('amount', 0)
            if amount > 0:
                print(f"Top-up request: +{amount}")
                pending_topup += amount
            else:
                print("Invalid top-up amount")
    except Exception as e:
        print(f"Error parsing message: {e}")

def main():
    global pending_topup, last_read_time
    
    # 1. Connect to Wi-Fi
    if not wifi_connect.connect():
        print("Failed to connect to Wi-Fi. Restarting...")
        time.sleep(5)
        machine.reset()

    # 2. Connect to MQTT
    try:
        client = MQTTClient("esp8266_rfid_client", config.MQTT_BROKER, port=config.MQTT_PORT)
        client.set_callback(on_message)
        client.connect()
        print("Connected to MQTT Broker")
        
        # Subscribe to Top-up topic
        client.subscribe(config.TOPIC_TOPUP)
        print(f"Subscribed to {config.TOPIC_TOPUP}")
    except Exception as e:
        print(f"Failed to connect to MQTT: {e}")
        return

    # 3. Initialize RFID
    try:
        rdr = MFRC522(sck=SCK_PIN, mosi=MOSI_PIN, miso=MISO_PIN, rst=RST_PIN, cs=SS_PIN)
        print("RFID Reader Initialized")
    except Exception as e:
        print(f"Failed to init RFID: {e}")
        return

    # 4. Main Loop
    print("\n--- READY TO SCAN ---")
    
    while True:
        try:
            # Check for incoming MQTT messages
            client.check_msg()
            
            # Scan for tags
            (stat, tag_type) = rdr.request(rdr.REQIDL)
            
            if stat == rdr.OK:
                (stat, uid) = rdr.anticoll()
                if stat == rdr.OK:
                    current_time = time.ticks_ms()
                    if time.ticks_diff(current_time, last_read_time) > READ_DELAY:
                        last_read_time = current_time
                        
                        uid_hex = "0x%02x%02x%02x%02x" % tuple(uid)
                        print(f"Tag detected: {uid_hex}")
                        
                        # Authenticate Sector 1 (Block 4-7)
                        if rdr.select_tag(uid) == rdr.OK:
                            status = rdr.auth(rdr.AUTHENT1A, BLOCK_ADDR, SECTOR_KEY, uid)
                            if status == rdr.OK:
                                # Read Balance
                                block_data = rdr.read(BLOCK_ADDR)
                                if block_data:
                                    # Convert bytes to integer (first 4 bytes)
                                    # Assuming Little Endian storage of int32
                                    balance = block_data[0] | (block_data[1] << 8) | (block_data[2] << 16) | (block_data[3] << 24)
                                    print(f"Current Balance: {balance}")
                                    
                                    # Handle Top-up
                                    if pending_topup > 0:
                                        new_balance = balance + pending_topup
                                        print(f"Applying Top-up: {balance} -> {new_balance}")
                                        
                                        # Write new balance (Little Endian)
                                        new_data = [0] * 16
                                        new_data[0] = new_balance & 0xFF
                                        new_data[1] = (new_balance >> 8) & 0xFF
                                        new_data[2] = (new_balance >> 16) & 0xFF
                                        new_data[3] = (new_balance >> 24) & 0xFF
                                        
                                        stat_write = rdr.write(BLOCK_ADDR, new_data)
                                        if stat_write == rdr.OK:
                                            print("Write Successful!")
                                            balance = new_balance
                                            pending_topup = 0 # Clear pending
                                        else:
                                            print("Write Failed!")
                                    
                                    # Publish info
                                    msg_status = json.dumps({"uid": uid_hex})
                                    msg_balance = json.dumps({"uid": uid_hex, "balance": balance})
                                    
                                    client.publish(config.TOPIC_STATUS, msg_status)
                                    client.publish(config.TOPIC_BALANCE, msg_balance)
                                    print("Published Status & Balance")
                                    
                                else:
                                    print("Failed to read block")
                            else:
                                print("Authentication Error")
                            rdr.stop_crypto1()
                        else:
                            print("Failed to select tag")
        except Exception as e:
            print(f"Loop error: {e}")
            # Try to reconnect if needed?
            # For simplicity, we just print error. In production, add reconnect logic.
            time.sleep(1)

        time.sleep(0.1)

if __name__ == "__main__":
    main()
