# wifi_connect.py
import network
import time
from config import WIFI_SSID, WIFI_PASS

def connect():
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)
    if not wlan.isconnected():
        print('Connecting to network...')
        wlan.connect(WIFI_SSID, WIFI_PASS)
        start_time = time.time()
        while not wlan.isconnected():
            time.sleep(1)
            # Timeout after 20 seconds
            if time.time() - start_time > 20:
                print("\nConnection timed out!")
                return False
    
    print('Network config:', wlan.ifconfig())
    return True
