# config.py
WIFI_SSID = "precieux"
WIFI_PASS = "121402pr0732021"
MQTT_BROKER = "157.173.101.159"
MQTT_PORT = 1883
TEAM_ID = "quantum_bitflip_0xDEAD"
TOPIC_PREFIX = "rfid/" + TEAM_ID

# Derived Topics
TOPIC_STATUS = TOPIC_PREFIX + "/card/status"   # Pub: Card detected
TOPIC_BALANCE = TOPIC_PREFIX + "/card/balance" # Pub: Current balance
TOPIC_TOPUP = TOPIC_PREFIX + "/card/topup"     # Sub: Command to add funds
