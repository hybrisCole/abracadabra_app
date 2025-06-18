import React, { useEffect, useState } from 'react';
import { StyleSheet, Alert, Platform, ScrollView } from 'react-native';
import { Text, View } from '@/components/Themed';

// Arduino device configuration
const DEVICE_CONFIG = {
  name: "AbracadabraIMU",
  serviceUUID: "8cfc8e26-0682-4f72-b0c0-c0c8e0b12a06",
  dataCharacteristicUUID: "780fe2ec-c87c-443e-bf01-78918d9d625b",
  commandCharacteristicUUID: "aa7e97b4-d7dc-4cb0-9fef-85875036520e"
};

// Types for sensor data
interface SensorData {
  timestamp: number;
  sampleId: number;
  accX: number;
  accY: number;
  accZ: number;
  gyroX: number;
  gyroY: number;
  gyroZ: number;
  recordingHash: string;
}

interface SessionData {
  sessionHash: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  sampleCount: number;
  samples: SensorData[];
  isActive: boolean;
}

export default function TabOneScreen() {
  const [bleSupported, setBleSupported] = useState<boolean | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [foundDevice, setFoundDevice] = useState<any>(null);
  const [connectedDevice, setConnectedDevice] = useState<any>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('Disconnected');
  const [scanStatus, setScanStatus] = useState('Initializing Bluetooth...');
  const [manager, setManager] = useState<any>(null);
  const [dataCharacteristic, setDataCharacteristic] = useState<any>(null);
  const [commandCharacteristic, setCommandCharacteristic] = useState<any>(null);

  // Data reception state
  const [currentSession, setCurrentSession] = useState<SessionData | null>(null);
  const [latestSensorData, setLatestSensorData] = useState<SensorData | null>(null);
  const [sessionHistory, setSessionHistory] = useState<SessionData[]>([]);
  const [totalPacketsReceived, setTotalPacketsReceived] = useState(0);
  const [dataRate, setDataRate] = useState(0); // packets per second
  const [lastDataTime, setLastDataTime] = useState<number>(0);

  // Data rate calculation
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      if (lastDataTime > 0 && now - lastDataTime < 2000) {
        // Calculate packets per second based on recent activity
        const timeDiff = (now - lastDataTime) / 1000;
        if (currentSession && currentSession.samples.length > 0) {
          setDataRate(Math.round(currentSession.samples.length / ((now - currentSession.startTime) / 1000)));
        }
      } else {
        setDataRate(0);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [lastDataTime, currentSession]);

  useEffect(() => {
    initializeBLE();
  }, []);

  const initializeBLE = async () => {
    try {
      // Dynamic import to avoid initialization error in Expo Go
      const { BleManager } = await import('react-native-ble-plx');
      const bleManager = new BleManager();
      setManager(bleManager);
      setBleSupported(true);
      setScanStatus('Bluetooth initialized, checking state...');
      
      // Wait a bit for BLE to fully initialize
      setTimeout(() => {
        startDeviceScan(bleManager);
      }, 1000);
      
    } catch (error) {
      console.log('BLE not supported in this environment:', error);
      setBleSupported(false);
      setScanStatus('BLE requires development build');
    }
  };

  const checkBluetoothState = async (bleManager: any, retryCount = 0) => {
    try {
      const state = await bleManager.state();
      console.log('Bluetooth state:', state);
      
      if (state === 'PoweredOn') {
        return true;
      } else if (state === 'Unknown' && retryCount < 3) {
        // Bluetooth state might still be initializing, retry
        console.log('Bluetooth state unknown, retrying...', retryCount + 1);
        await new Promise(resolve => setTimeout(resolve, 1000));
        return checkBluetoothState(bleManager, retryCount + 1);
      } else {
        setScanStatus(`Bluetooth state: ${state}`);
        return false;
      }
    } catch (error) {
      console.log('Error checking Bluetooth state:', error);
      if (retryCount < 2) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return checkBluetoothState(bleManager, retryCount + 1);
      }
      return false;
    }
  };

  const connectToDevice = async (device: any) => {
    if (!manager || !device) {
      console.log('Manager or device not available for connection');
      return;
    }

    try {
      setIsConnecting(true);
      setConnectionStatus('Connecting...');
      console.log('Attempting to connect to device:', device.id);

      // Connect to the device
      const connectedDevice = await device.connectWithTimeout(10000); // 10 second timeout
      console.log('Connected to device:', connectedDevice.id);
      
      setConnectedDevice(connectedDevice);
      setConnectionStatus('Connected - Discovering services...');

      // Discover all services and characteristics
      console.log('Discovering services and characteristics...');
      await connectedDevice.discoverAllServicesAndCharacteristics();
      
      setConnectionStatus('Connected - Setting up notifications...');

      // Get the gesture service
      const services = await connectedDevice.services();
      console.log('Available services:', services.map(s => s.uuid));
      
      const gestureService = services.find(service => 
        service.uuid.toLowerCase() === DEVICE_CONFIG.serviceUUID.toLowerCase()
      );

      if (!gestureService) {
        throw new Error(`Gesture service ${DEVICE_CONFIG.serviceUUID} not found`);
      }

      console.log('Found gesture service:', gestureService.uuid);

      // Get characteristics
      const characteristics = await gestureService.characteristics();
      console.log('Available characteristics:', characteristics.map(c => c.uuid));

      const dataChar = characteristics.find(char => 
        char.uuid.toLowerCase() === DEVICE_CONFIG.dataCharacteristicUUID.toLowerCase()
      );
      
      const commandChar = characteristics.find(char => 
        char.uuid.toLowerCase() === DEVICE_CONFIG.commandCharacteristicUUID.toLowerCase()
      );

      if (!dataChar) {
        throw new Error(`Data characteristic ${DEVICE_CONFIG.dataCharacteristicUUID} not found`);
      }

      if (!commandChar) {
        throw new Error(`Command characteristic ${DEVICE_CONFIG.commandCharacteristicUUID} not found`);
      }

      console.log('Found data characteristic:', dataChar.uuid);
      console.log('Found command characteristic:', commandChar.uuid);

      setDataCharacteristic(dataChar);
      setCommandCharacteristic(commandChar);

      // Subscribe to data characteristic notifications
      console.log('Subscribing to data notifications...');
      dataChar.monitor((error: any, characteristic: any) => {
        if (error) {
          console.log('Notification error:', error);
          return;
        }

        if (characteristic?.value) {
          handleBLEData(characteristic.value);
        }
      });

      // Set up connection monitoring
      connectedDevice.onDisconnected((error: any, device: any) => {
        console.log('Device disconnected:', device?.id, error);
        setConnectedDevice(null);
        setDataCharacteristic(null);
        setCommandCharacteristic(null);
        setConnectionStatus('Disconnected');
        
        // Clear current session on disconnect
        if (currentSession?.isActive) {
          setCurrentSession(prev => prev ? { ...prev, isActive: false } : null);
        }
        
        // Show disconnection alert
        Alert.alert(
          '📱 Device Disconnected',
          'The Arduino device has been disconnected.',
          [
            { text: 'Reconnect', onPress: () => startDeviceScan(manager) },
            { text: 'OK' }
          ]
        );
      });

      setConnectionStatus('Connected & Ready');
      setIsConnecting(false);

      // Send a test ping command
      console.log('Sending ping command...');
      await commandChar.writeWithResponse(Buffer.from('ping', 'utf8').toString('base64'));

      // Success alert
      Alert.alert(
        '🎉 Connection Successful!',
        `Connected to ${device.name}\n\n✅ Services discovered\n✅ Notifications active\n✅ Ready for gesture data`,
        [{ text: 'Great!' }]
      );

    } catch (error) {
      console.log('Connection error:', error);
      setIsConnecting(false);
      setConnectionStatus('Connection Failed');
      
      Alert.alert(
        '❌ Connection Failed',
        `Could not connect to ${device.name}\n\nError: ${error}\n\nMake sure the device is nearby and not connected to another app.`,
        [
          { text: 'Retry', onPress: () => connectToDevice(device) },
          { text: 'Cancel' }
        ]
      );
    }
  };

  const handleBLEData = (base64Data: string) => {
    try {
      // Convert base64 to buffer
      const buffer = Buffer.from(base64Data, 'base64');
      
      // Parse the 20-byte BLE packet structure
      if (buffer.length === 20) {
        const packetType = buffer.readUInt8(0);
        const reserved = buffer.readUInt8(1);
        const timestamp = buffer.readUInt16LE(2);
        const sampleId = buffer.readUInt16LE(4);
        const accX = buffer.readInt16LE(6) / 1000.0; // Convert back from scaled integer
        const accY = buffer.readInt16LE(8) / 1000.0;
        const accZ = buffer.readInt16LE(10) / 1000.0;
        const gyroX = buffer.readInt16LE(12) / 10.0; // Convert back from scaled integer
        const gyroY = buffer.readInt16LE(14) / 10.0;
        const gyroZ = buffer.readInt16LE(16) / 10.0;
        const recordingHash = buffer.readUInt32LE(18);

        const hashString = `0x${recordingHash.toString(16)}`;
        const now = Date.now();

        // Update total packets received
        setTotalPacketsReceived(prev => prev + 1);
        setLastDataTime(now);

        // Handle different packet types
        switch (packetType) {
          case 0x01: // SESSION_START
            console.log(`🎬 Gesture session started (Hash: ${hashString})`);
            
            // Create new session
            const newSession: SessionData = {
              sessionHash: hashString,
              startTime: now,
              sampleCount: 0,
              samples: [],
              isActive: true
            };
            
            setCurrentSession(newSession);
            break;

          case 0x02: // SENSOR_DATA
            // Create sensor data object
            const sensorData: SensorData = {
              timestamp,
              sampleId,
              accX,
              accY,
              accZ,
              gyroX,
              gyroY,
              gyroZ,
              recordingHash: hashString
            };

            // Update latest sensor data for real-time display
            setLatestSensorData(sensorData);

            // Add to current session if active
            if (currentSession?.isActive && currentSession.sessionHash === hashString) {
              setCurrentSession(prev => {
                if (!prev) return null;
                return {
                  ...prev,
                  sampleCount: prev.sampleCount + 1,
                  samples: [...prev.samples, sensorData]
                };
              });
            }
            break;

          case 0x03: // SESSION_END
            console.log(`🎬 Gesture session ended (Duration: ${timestamp}ms, Samples: ${sampleId + 1})`);
            
            // Finalize current session
            if (currentSession?.isActive && currentSession.sessionHash === hashString) {
              const finalizedSession: SessionData = {
                ...currentSession,
                endTime: now,
                duration: timestamp,
                sampleCount: sampleId + 1,
                isActive: false
              };

              setCurrentSession(finalizedSession);
              
              // Add to session history
              setSessionHistory(prev => [finalizedSession, ...prev.slice(0, 9)]); // Keep last 10 sessions
              
              console.log(`📊 Session completed: ${finalizedSession.samples.length} samples collected`);
            }
            break;
        }

        // Log packet info occasionally to avoid spam
        if (sampleId % 100 === 0 || packetType !== 0x02) {
          const packetTypeNames = {
            0x01: 'SESSION_START',
            0x02: 'SENSOR_DATA',
            0x03: 'SESSION_END'
          };
          
          console.log(`BLE Packet [${packetTypeNames[packetType as keyof typeof packetTypeNames] || 'UNKNOWN'}]:`, {
            type: packetType,
            timestamp,
            sampleId,
            hash: hashString,
            ...(packetType === 0x02 && {
              acc: { x: accX.toFixed(3), y: accY.toFixed(3), z: accZ.toFixed(3) },
              gyro: { x: gyroX.toFixed(1), y: gyroY.toFixed(1), z: gyroZ.toFixed(1) }
            })
          });
        }
      } else {
        console.log('Received BLE data with unexpected length:', buffer.length);
      }
    } catch (error) {
      console.log('Error parsing BLE data:', error);
    }
  };

  const startDeviceScan = async (bleManager: any) => {
    if (!bleManager) {
      setScanStatus('BLE not initialized');
      return;
    }

    try {
      setIsScanning(true);
      setScanStatus('Checking Bluetooth state...');

      // Check if Bluetooth is powered on with retry logic
      const isBluetoothOn = await checkBluetoothState(bleManager);
      
      if (!isBluetoothOn) {
        setScanStatus('Bluetooth is not powered on');
        Alert.alert(
          'Bluetooth Required',
          'Please make sure Bluetooth is enabled in iOS Settings.',
          [
            { text: 'Retry', onPress: () => startDeviceScan(bleManager) },
            { text: 'Cancel' }
          ]
        );
        setIsScanning(false);
        return;
      }

      setScanStatus('Scanning for Arduino device...');
      console.log('Starting BLE scan for', DEVICE_CONFIG.name);

      // Start scanning for devices
      bleManager.startDeviceScan(null, null, (error: any, device: any) => {
        if (error) {
          console.log('Scan error:', error);
          setScanStatus(`Scan error: ${error.message}`);
          setIsScanning(false);
          return;
        }

        console.log('Found device:', device?.name, device?.id);

        if (device && device.name === DEVICE_CONFIG.name) {
          // Found our Arduino device!
          console.log('Found Arduino device:', device);
          setFoundDevice(device);
          setScanStatus(`Found ${device.name}!`);
          
          // Stop scanning
          bleManager.stopDeviceScan();
          setIsScanning(false);

          // Automatically connect to the device
          connectToDevice(device);
        }
      });

      // Stop scanning after 15 seconds if device not found
      setTimeout(() => {
        if (isScanning) {
          bleManager.stopDeviceScan();
          setIsScanning(false);
          if (!foundDevice) {
            setScanStatus('Arduino device not found. Make sure it\'s powered on.');
            Alert.alert(
              '🔍 Device Not Found',
              'Could not find "AbracadabraIMU" device.\n\nMake sure:\n• Arduino is powered on\n• Bluetooth is enabled\n• Device is nearby',
              [
                { text: 'Retry', onPress: () => startDeviceScan(bleManager) },
                { text: 'Cancel' }
              ]
            );
          }
        }
      }, 15000);

    } catch (error) {
      console.log('Error starting scan:', error);
      setScanStatus(`Error: ${error}`);
      setIsScanning(false);
    }
  };

  const disconnectDevice = async () => {
    if (connectedDevice) {
      try {
        await connectedDevice.cancelConnection();
        console.log('Device disconnected successfully');
      } catch (error) {
        console.log('Error disconnecting:', error);
      }
    }
  };

  const clearSessionHistory = () => {
    setSessionHistory([]);
    setTotalPacketsReceived(0);
    setCurrentSession(null);
    setLatestSensorData(null);
  };

  const getStatusColor = () => {
    if (bleSupported === false) return '#FF5722'; // Red
    if (connectedDevice) return '#4CAF50'; // Green
    if (isConnecting) return '#FF9800'; // Orange
    if (foundDevice) return '#2196F3'; // Blue
    if (isScanning) return '#2196F3'; // Blue
    return '#FF9800'; // Orange
  };

  const getStatusIcon = () => {
    if (bleSupported === false) return '⚠️';
    if (connectedDevice) return '✅';
    if (isConnecting) return '🔄';
    if (foundDevice) return '📱';
    if (isScanning) return '🔍';
    return '📱';
  };

  const getCurrentStatus = () => {
    if (connectedDevice) return connectionStatus;
    if (isConnecting) return 'Connecting to device...';
    if (foundDevice) return `Found ${foundDevice.name}!`;
    return scanStatus;
  };

  const buildDevelopmentBuild = () => {
    Alert.alert(
      'Development Build Required',
      'To use Bluetooth, you need to create an Expo development build:\n\n1. Run: npx expo install --fix\n2. Run: npx expo run:ios (or android)\n\nOr scan with a development build app.',
      [{ text: 'Got it!' }]
    );
  };

  const retryScanning = () => {
    if (manager) {
      startDeviceScan(manager);
    } else {
      initializeBLE();
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <Text style={styles.title}>Abracadabra App</Text>
      
      <View style={[styles.statusContainer, { backgroundColor: getStatusColor() }]}>
        <Text style={styles.statusIcon}>{getStatusIcon()}</Text>
        <Text style={styles.statusText}>{getCurrentStatus()}</Text>
      </View>

      {bleSupported === false && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorTitle}>Bluetooth Not Available</Text>
          <Text style={styles.errorText}>
            This app requires native Bluetooth access. You're likely running in Expo Go.
          </Text>
          <Text 
            style={styles.linkText} 
            onPress={buildDevelopmentBuild}
          >
            📱 How to create development build
          </Text>
        </View>
      )}

      {!isScanning && !foundDevice && !connectedDevice && bleSupported && (
        <View style={styles.retryContainer}>
          <Text 
            style={styles.retryButton} 
            onPress={retryScanning}
          >
            🔄 Retry Scanning
          </Text>
        </View>
      )}

      {connectedDevice && (
        <View style={styles.deviceInfo}>
          <Text style={styles.deviceTitle}>Connected Device:</Text>
          <Text style={styles.deviceText}>Name: {connectedDevice.name}</Text>
          <Text style={styles.deviceText}>MAC: {connectedDevice.id}</Text>
          <Text style={styles.deviceText}>Status: {connectionStatus}</Text>
          
          <Text 
            style={styles.disconnectButton} 
            onPress={disconnectDevice}
          >
            🔌 Disconnect
          </Text>
        </View>
      )}

      {/* Real-time Data Display */}
      {connectedDevice && (
        <View style={styles.dataContainer}>
          <Text style={styles.dataTitle}>📊 Live Data Stream</Text>
          
          <View style={styles.statsRow}>
            <Text style={styles.statText}>Packets: {totalPacketsReceived}</Text>
            <Text style={styles.statText}>Rate: {dataRate} Hz</Text>
          </View>

          {currentSession?.isActive && (
            <View style={styles.sessionInfo}>
              <Text style={styles.sessionTitle}>🎬 Recording Session</Text>
              <Text style={styles.sessionText}>Hash: {currentSession.sessionHash}</Text>
              <Text style={styles.sessionText}>Samples: {currentSession.sampleCount}</Text>
              <Text style={styles.sessionText}>Duration: {Math.round((Date.now() - currentSession.startTime) / 1000)}s</Text>
            </View>
          )}

          {latestSensorData && (
            <View style={styles.sensorData}>
              <Text style={styles.sensorTitle}>Latest Sensor Reading:</Text>
              <View style={styles.sensorRow}>
                <Text style={styles.sensorLabel}>Accel:</Text>
                <Text style={styles.sensorValue}>
                  X: {latestSensorData.accX.toFixed(3)}g
                </Text>
                <Text style={styles.sensorValue}>
                  Y: {latestSensorData.accY.toFixed(3)}g
                </Text>
                <Text style={styles.sensorValue}>
                  Z: {latestSensorData.accZ.toFixed(3)}g
                </Text>
              </View>
              <View style={styles.sensorRow}>
                <Text style={styles.sensorLabel}>Gyro:</Text>
                <Text style={styles.sensorValue}>
                  X: {latestSensorData.gyroX.toFixed(1)}°/s
                </Text>
                <Text style={styles.sensorValue}>
                  Y: {latestSensorData.gyroY.toFixed(1)}°/s
                </Text>
                <Text style={styles.sensorValue}>
                  Z: {latestSensorData.gyroZ.toFixed(1)}°/s
                </Text>
              </View>
            </View>
          )}
        </View>
      )}

      {/* Session History */}
      {sessionHistory.length > 0 && (
        <View style={styles.historyContainer}>
          <View style={styles.historyHeader}>
            <Text style={styles.historyTitle}>📝 Session History</Text>
            <Text style={styles.clearButton} onPress={clearSessionHistory}>
              🗑️ Clear
            </Text>
          </View>
          
          {sessionHistory.slice(0, 3).map((session, index) => (
            <View key={session.sessionHash} style={styles.historyItem}>
              <Text style={styles.historyText}>
                Session {index + 1}: {session.sampleCount} samples
              </Text>
              <Text style={styles.historySubtext}>
                Duration: {session.duration}ms | Hash: {session.sessionHash}
              </Text>
            </View>
          ))}
        </View>
      )}

      <View style={styles.instructions}>
        <Text style={styles.instructionText}>
          {bleSupported === false 
            ? '🔧 Create development build to use Bluetooth'
            : connectedDevice 
              ? currentSession?.isActive
                ? '🔴 Recording in progress... Perform your gesture!'
                : '🎉 Ready to receive gesture data! Double-tap your Arduino to start recording.' 
              : isConnecting
                ? '⏳ Connecting to your Arduino device...'
                : foundDevice
                  ? '📱 Device found, connecting automatically...'
                  : '⚡ Power on your Arduino device to connect'
          }
        </Text>
      </View>

      <View style={styles.configInfo}>
        <Text style={styles.configTitle}>Looking for:</Text>
        <Text style={styles.configText}>Device: {DEVICE_CONFIG.name}</Text>
        <Text style={styles.configText}>Service: {DEVICE_CONFIG.serviceUUID}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 30,
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    borderRadius: 10,
    marginBottom: 20,
    minWidth: 250,
    justifyContent: 'center',
  },
  statusIcon: {
    fontSize: 20,
    marginRight: 10,
  },
  statusText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  errorContainer: {
    backgroundColor: '#2c1810',
    padding: 15,
    borderRadius: 10,
    marginBottom: 20,
    maxWidth: 300,
    borderWidth: 1,
    borderColor: '#5d4037',
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#ff8a65',
    marginBottom: 10,
    textAlign: 'center',
  },
  errorText: {
    fontSize: 14,
    color: '#ff8a65',
    textAlign: 'center',
    marginBottom: 10,
  },
  linkText: {
    fontSize: 14,
    color: '#4A90E2',
    textAlign: 'center',
    textDecorationLine: 'underline',
  },
  retryContainer: {
    marginBottom: 20,
  },
  retryButton: {
    fontSize: 16,
    color: '#4A90E2',
    textAlign: 'center',
    padding: 10,
    backgroundColor: '#1a2332',
    borderRadius: 8,
    fontWeight: '600',
  },
  deviceInfo: {
    backgroundColor: '#1e2328',
    padding: 15,
    borderRadius: 10,
    marginBottom: 20,
    minWidth: 250,
    borderWidth: 1,
    borderColor: '#4A90E2',
  },
  deviceTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 10,
    textAlign: 'center',
  },
  deviceText: {
    fontSize: 14,
    marginBottom: 5,
    fontFamily: 'monospace',
  },
  disconnectButton: {
    fontSize: 14,
    color: '#FF5722',
    textAlign: 'center',
    padding: 8,
    backgroundColor: '#2a1a1a',
    borderRadius: 6,
    marginTop: 10,
    fontWeight: '600',
  },
  dataContainer: {
    backgroundColor: '#1a2a1a',
    padding: 15,
    borderRadius: 10,
    marginBottom: 20,
    minWidth: 300,
    borderWidth: 1,
    borderColor: '#4CAF50',
  },
  dataTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 10,
    textAlign: 'center',
    color: '#4CAF50',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 10,
  },
  statText: {
    fontSize: 12,
    color: '#9BA1A6',
    fontFamily: 'monospace',
  },
  sessionInfo: {
    backgroundColor: '#2a1a2a',
    padding: 10,
    borderRadius: 8,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#FF9800',
  },
  sessionTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#FF9800',
    marginBottom: 5,
  },
  sessionText: {
    fontSize: 12,
    color: '#ECEDEE',
    fontFamily: 'monospace',
    marginBottom: 2,
  },
  sensorData: {
    backgroundColor: '#1a1a2a',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2196F3',
  },
  sensorTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#2196F3',
    marginBottom: 5,
  },
  sensorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 3,
  },
  sensorLabel: {
    fontSize: 12,
    color: '#9BA1A6',
    width: 50,
    fontWeight: 'bold',
  },
  sensorValue: {
    fontSize: 11,
    color: '#ECEDEE',
    fontFamily: 'monospace',
    marginRight: 8,
    minWidth: 70,
  },
  historyContainer: {
    backgroundColor: '#2a2a1a',
    padding: 15,
    borderRadius: 10,
    marginBottom: 20,
    minWidth: 300,
    borderWidth: 1,
    borderColor: '#9BA1A6',
  },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  historyTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#9BA1A6',
  },
  clearButton: {
    fontSize: 12,
    color: '#FF5722',
    padding: 5,
    backgroundColor: '#2a1a1a',
    borderRadius: 4,
  },
  historyItem: {
    backgroundColor: '#1a1a1a',
    padding: 8,
    borderRadius: 6,
    marginBottom: 5,
  },
  historyText: {
    fontSize: 12,
    color: '#ECEDEE',
    fontWeight: 'bold',
  },
  historySubtext: {
    fontSize: 10,
    color: '#9BA1A6',
    fontFamily: 'monospace',
  },
  instructions: {
    marginTop: 20,
    padding: 15,
    backgroundColor: '#1a2332',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2a3441',
  },
  instructionText: {
    fontSize: 14,
    textAlign: 'center',
    fontStyle: 'italic',
    color: '#ECEDEE',
  },
  configInfo: {
    marginTop: 20,
    padding: 10,
    backgroundColor: '#2a1e2b',
    borderRadius: 8,
    maxWidth: 300,
    borderWidth: 1,
    borderColor: '#4a3f4b',
  },
  configTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 5,
    textAlign: 'center',
    color: '#ECEDEE',
  },
  configText: {
    fontSize: 10,
    fontFamily: 'monospace',
    textAlign: 'center',
    marginBottom: 2,
    color: '#9BA1A6',
  },
});
