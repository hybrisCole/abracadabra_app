import React, { useEffect, useState, useRef } from 'react';
import { StyleSheet, Alert, Platform, ScrollView, Pressable, PermissionsAndroid } from 'react-native';
import { Text, View } from '@/components/Themed';
import { BleManager } from 'react-native-ble-plx';

// Arduino device configuration
const DEVICE_CONFIG = {
  name: "AbracadabraIMU",
  serviceUUID: "8cfc8e26-0682-4f72-b0c0-c0c8e0b12a06",
  dataCharacteristicUUID: "780fe2ec-c87c-443e-bf01-78918d9d625b",
  commandCharacteristicUUID: "aa7e97b4-d7dc-4cb0-9fef-85875036520e"
};

interface GestureSession {
  id: string;
  startTime: number;
  endTime?: number;
  isActive: boolean;
  deviceId: string;
  samplesReceived: number;
}

interface BLEDataPoint {
  timestamp: number;
  sampleId: number;
  acceleration: { x: number; y: number; z: number };
  gyroscope: { x: number; y: number; z: number };
  recordingHash: string;
}

export default function TabOneScreen() {
  const [bleSupported, setBleSupported] = useState<boolean | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [foundDevice, setFoundDevice] = useState<any>(null);
  const [connectedDevice, setConnectedDevice] = useState<any>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('Disconnected');
  const [connectionQuality, setConnectionQuality] = useState<'Excellent' | 'Good' | 'Poor' | 'Unknown'>('Unknown');
  const [scanStatus, setScanStatus] = useState('Initializing Bluetooth...');
  const [manager, setManager] = useState<BleManager | null>(null);
  const [dataCharacteristic, setDataCharacteristic] = useState<any>(null);
  const [commandCharacteristic, setCommandCharacteristic] = useState<any>(null);

  // Data storage in React state
  const [currentSession, setCurrentSession] = useState<GestureSession | null>(null);
  const [sessionData, setSessionData] = useState<BLEDataPoint[]>([]);
  const [latestDataPoint, setLatestDataPoint] = useState<BLEDataPoint | null>(null);
  const [sessionHistory, setSessionHistory] = useState<GestureSession[]>([]);
  const [totalPacketsReceived, setTotalPacketsReceived] = useState(0);
  const [dataRate, setDataRate] = useState(0); // packets per second
  const [lastDataTime, setLastDataTime] = useState<number>(0);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingProgress, setRecordingProgress] = useState(0);

  // New debug states
  const [permissionsGranted, setPermissionsGranted] = useState(false);
  const [scannedDevices, setScannedDevices] = useState<any[]>([]);
  const [debugMode, setDebugMode] = useState(true); // Enable debug mode by default

  // Request necessary permissions for BLE
  const requestPermissions = async () => {
    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        ]);

        const allGranted = Object.values(granted).every(
          permission => permission === PermissionsAndroid.RESULTS.GRANTED
        );

        setPermissionsGranted(allGranted);
        
        if (!allGranted) {
          Alert.alert(
            'Permissions Required',
            'This app needs Bluetooth and Location permissions to work properly.',
            [{ text: 'OK' }]
          );
          return false;
        }
        return true;
      } catch (err) {
        console.warn('Permission request error:', err);
        return false;
      }
    } else {
      // iOS permissions are handled through Info.plist
      setPermissionsGranted(true);
      return true;
    }
  };

  // Real-time connection monitoring
  useEffect(() => {
    const interval = setInterval(() => {
      if (connectedDevice) {
        // Monitor connection quality based on data flow
        const now = Date.now();
        const timeSinceLastData = now - lastDataTime;
        
        if (timeSinceLastData < 1000) {
          setConnectionQuality('Excellent');
        } else if (timeSinceLastData < 3000) {
          setConnectionQuality('Good');
        } else if (timeSinceLastData < 10000) {
          setConnectionQuality('Poor');
        } else {
          setConnectionQuality('Unknown');
        }
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [connectedDevice, lastDataTime]);

  // Data rate calculation and recording progress
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      if (lastDataTime > 0 && now - lastDataTime < 2000) {
        // Calculate packets per second based on recent activity
        if (currentSession && sessionData.length > 0) {
          const sessionDuration = (now - currentSession.startTime) / 1000;
          setDataRate(Math.round(sessionData.length / sessionDuration));
        }
      } else {
        setDataRate(0);
      }

      // Update recording progress for active sessions
      if (currentSession?.isActive) {
        const elapsed = now - currentSession.startTime;
        const estimatedDuration = 4000; // 4 seconds typical recording
        const progress = Math.min((elapsed / estimatedDuration) * 100, 100);
        setRecordingProgress(progress);
      } else {
        setRecordingProgress(0);
      }
    }, 100); // Update more frequently for smooth progress

    return () => clearInterval(interval);
  }, [lastDataTime, currentSession, sessionData]);

  useEffect(() => {
    const initializeBLE = async () => {
      console.log('🚀 Starting BLE initialization...');
      setScanStatus('Requesting permissions...');
      
      // First, request permissions
      const permissionsOk = await requestPermissions();
      if (!permissionsOk) {
        setScanStatus('Permissions denied - cannot scan for devices');
        return;
      }

      try {
        console.log('🔵 Creating BLE Manager...');
        const bleManager = new BleManager();
        setManager(bleManager);
        
        // Check BLE support
        bleManager.onStateChange((state) => {
          console.log('🔵 BLE State changed to:', state);
          if (state === 'PoweredOn') {
            setBleSupported(true);
            setScanStatus('Bluetooth ready');
            // Start scanning after a short delay
            setTimeout(() => {
              startDeviceScan(bleManager);
            }, 1000);
          } else {
            setBleSupported(false);
            setScanStatus(`Bluetooth state: ${state}`);
          }
        }, true);
        
      } catch (error) {
        console.log('❌ BLE initialization error:', error);
        setScanStatus('BLE initialization failed');
      }
    };

    initializeBLE();

    // Cleanup on unmount
    return () => {
      if (manager) {
        manager.stopDeviceScan();
        if (connectedDevice) {
          connectedDevice.cancelConnection();
        }
      }
    };
  }, []);

  const checkBluetoothState = async (bleManager: BleManager, retryCount = 0) => {
    try {
      const state = await bleManager.state();
      console.log('🔵 Bluetooth state:', state);
      
      if (state === 'PoweredOn') {
        return true;
      } else if (state === 'Unknown' && retryCount < 3) {
        // Bluetooth state might still be initializing, retry
        console.log('🔵 Bluetooth state unknown, retrying...', retryCount + 1);
        await new Promise(resolve => setTimeout(resolve, 1000));
        return checkBluetoothState(bleManager, retryCount + 1);
      } else {
        setScanStatus(`Bluetooth state: ${state}`);
        return false;
      }
    } catch (error) {
      console.log('❌ Error checking Bluetooth state:', error);
      if (retryCount < 2) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return checkBluetoothState(bleManager, retryCount + 1);
      }
      return false;
    }
  };

  // Gesture analysis function
  const analyzeGesture = (sessionData: BLEDataPoint[]) => {
    if (sessionData.length === 0) return null;

    // Calculate basic statistics
    const totalSamples = sessionData.length;
    const duration = sessionData[sessionData.length - 1]?.timestamp - sessionData[0]?.timestamp;
    
    // Calculate acceleration magnitudes
    const accMagnitudes = sessionData.map(point => {
      const { acceleration } = point;
      return Math.sqrt(acceleration.x * acceleration.x + acceleration.y * acceleration.y + acceleration.z * acceleration.z);
    });
    
    // Calculate gyroscope magnitudes
    const gyroMagnitudes = sessionData.map(point => {
      const { gyroscope } = point;
      return Math.sqrt(gyroscope.x * gyroscope.x + gyroscope.y * gyroscope.y + gyroscope.z * gyroscope.z);
    });
    
    // Basic statistics
    const avgAccelMagnitude = accMagnitudes.reduce((a, b) => a + b, 0) / accMagnitudes.length;
    const avgGyroMagnitude = gyroMagnitudes.reduce((a, b) => a + b, 0) / gyroMagnitudes.length;
    const maxAccelMagnitude = Math.max(...accMagnitudes);
    const maxGyroMagnitude = Math.max(...gyroMagnitudes);
    
    return {
      totalSamples,
      duration,
      avgAccelMagnitude: avgAccelMagnitude.toFixed(3),
      maxAccelMagnitude: maxAccelMagnitude.toFixed(3),
      avgGyroMagnitude: avgGyroMagnitude.toFixed(1),
      maxGyroMagnitude: maxGyroMagnitude.toFixed(1),
      samplingRate: ((totalSamples / (duration / 1000)) || 0).toFixed(1)
    };
  };

  const connectToDevice = async (device: any, bleManager?: BleManager) => {
    // Use passed manager or fallback to state manager
    const currentManager = bleManager || manager;
    
    console.log('connectToDevice called with:', {
      deviceAvailable: !!device,
      managerAvailable: !!currentManager,
      passedManagerAvailable: !!bleManager,
      stateManagerAvailable: !!manager,
      deviceId: device?.id,
      deviceName: device?.name
    });

    if (!currentManager) {
      console.error('BLE Manager not available for connection');
      Alert.alert('Connection Error', 'Bluetooth manager not initialized. Please restart the app.');
      return;
    }

    if (!device) {
      console.error('Device not available for connection');
      Alert.alert('Connection Error', 'Device information not available. Please retry scanning.');
      return;
    }

    try {
      setIsConnecting(true);
      setConnectionStatus('Connecting to device...');
      console.log('Attempting to connect to device:', device.id);

      // Connect to the device through the manager with timeout
      console.log('Calling manager.connectToDevice...');
      
      // Create a timeout promise to prevent hanging
      const connectTimeout = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Connection timeout after 15 seconds')), 15000);
      });
      
      // Race between connection and timeout
      const connectedDevice = await Promise.race([
        currentManager.connectToDevice(device.id),
        connectTimeout
      ]);
      
      console.log('Successfully connected to device:', connectedDevice.id);
      console.log('Device connection state:', connectedDevice.isConnected);
      
      setConnectedDevice(connectedDevice);
      setConnectionStatus('Connected - Discovering services...');

      // Discover all services and characteristics with timeout
      console.log('Discovering services and characteristics...');
      
      const discoveryTimeout = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Service discovery timeout after 10 seconds')), 10000);
      });
      
      await Promise.race([
        connectedDevice.discoverAllServicesAndCharacteristics(),
        discoveryTimeout
      ]);
      
      console.log('Service discovery completed');
      
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
      const subscription = dataChar.monitor((error: any, characteristic: any) => {
        if (error) {
          console.log('Notification error:', error);
          return;
        }

        if (characteristic?.value) {
          handleBLEData(characteristic.value);
        }
      });

      console.log('Data notifications subscribed successfully');

      // Set up connection monitoring
      connectedDevice.onDisconnected((error: any, device: any) => {
        console.log('Device disconnected:', device?.id, error);
        setConnectedDevice(null);
        setDataCharacteristic(null);
        setCommandCharacteristic(null);
        setConnectionStatus('Disconnected');
        setConnectionQuality('Unknown');
        setIsRecording(false);
        
        // Clear current session on disconnect
        if (currentSession?.isActive) {
          setCurrentSession(prev => prev ? { ...prev, isActive: false } : null);
        }
        
        // Show disconnection alert
        Alert.alert(
          '📱 Device Disconnected',
          'The Arduino device has been disconnected.',
          [
            { text: 'Reconnect', onPress: () => startDeviceScan() },
            { text: 'OK' }
          ]
        );
      });

      setConnectionStatus('Connected & Ready');
      setConnectionQuality('Excellent');
      setIsConnecting(false);

      // Send a test ping command
      console.log('Sending ping command...');
      try {
        // Convert string to base64 for React Native
        const pingData = btoa('ping'); // btoa is available in React Native
        await commandChar.writeWithResponse(pingData);
        console.log('Ping command sent successfully');
      } catch (pingError) {
        console.log('Ping command failed (non-critical):', pingError);
      }

      // Success alert
      Alert.alert(
        '🎉 Connection Successful!',
        `Connected to ${device.name}\n\n✅ Services discovered\n✅ Notifications active\n✅ Ready for gesture data`,
        [{ text: 'Great!' }]
      );

    } catch (error) {
      console.error('Connection error:', error);
      setIsConnecting(false);
      setConnectionStatus('Connection Failed');
      setConnectionQuality('Unknown');
      
      // Determine error type and provide specific guidance
      let errorMessage = 'Unknown connection error';
      let troubleshooting = '';
      
      if (error.message?.includes('timeout')) {
        errorMessage = 'Connection timed out';
        troubleshooting = '\n• Move closer to the device\n• Make sure the device is powered on\n• Check if another app is connected to the device';
      } else if (error.message?.includes('Service discovery')) {
        errorMessage = 'Could not discover device services';
        troubleshooting = '\n• The device may not be running the correct firmware\n• Try restarting the Arduino device';
      } else if (error.message?.includes('characteristic')) {
        errorMessage = 'Device services incompatible';
        troubleshooting = '\n• Make sure the Arduino is running the latest firmware\n• Check that the device is an AbracadabraIMU device';
      } else {
        errorMessage = error.message || 'Connection failed';
        troubleshooting = '\n• Make sure Bluetooth is enabled\n• Try restarting the app\n• Move closer to the device';
      }
      
      Alert.alert(
        '❌ Connection Failed',
        `${errorMessage}\n\nTroubleshooting:${troubleshooting}`,
        [
          { text: 'Retry', onPress: () => connectToDevice(device, currentManager) },
          { text: 'Rescan', onPress: () => startDeviceScan() },
          { text: 'Cancel' }
        ]
      );
    }
  };

  // Handle BLE data packets from Arduino
  const handleBLEData = (base64Data: string) => {
    try {
      // Decode base64 to binary data
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Check if we have the expected packet size (20 bytes)
      if (bytes.length !== 20) {
        console.log('Unexpected packet size:', bytes.length);
        return;
      }

      // Parse the BLE packet according to Arduino's BLEPacket structure
      const dataView = new DataView(bytes.buffer);
      
      const packetType = dataView.getUint8(0);
      const reserved = dataView.getUint8(1);
      const timestamp = dataView.getUint16(2, true); // little endian
      const sampleId = dataView.getUint16(4, true);
      const accX = dataView.getInt16(6, true) / 1000.0; // Convert back from scaled int
      const accY = dataView.getInt16(8, true) / 1000.0;
      const accZ = dataView.getInt16(10, true) / 1000.0;
      const gyroX = dataView.getInt16(12, true) / 10.0; // Convert back from scaled int
      const gyroY = dataView.getInt16(14, true) / 10.0;
      const gyroZ = dataView.getInt16(16, true) / 10.0;
      const recordingHash = dataView.getUint32(16, true); // Note: overlaps with gyroZ

      // Handle different packet types
      if (packetType === 0x01) {
        // SESSION_START packet
        console.log('🎬 Session start detected, Hash:', recordingHash.toString(16));
        
        const newSession: GestureSession = {
          id: recordingHash.toString(16),
          startTime: Date.now(),
          isActive: true,
          deviceId: connectedDevice?.id || 'unknown',
          samplesReceived: 0
        };
        
        setCurrentSession(newSession);
        setSessionData([]);
        setIsRecording(true);
        
      } else if (packetType === 0x02) {
        // SENSOR_DATA packet
        const dataPoint: BLEDataPoint = {
          timestamp,
          sampleId,
          acceleration: { x: accX, y: accY, z: accZ },
          gyroscope: { x: gyroX, y: gyroY, z: gyroZ },
          recordingHash: recordingHash.toString(16)
        };
        
        setLatestDataPoint(dataPoint);
        setSessionData(prev => [...prev, dataPoint]);
        
        // Update session sample count
        if (currentSession?.isActive) {
          setCurrentSession(prev => prev ? { 
            ...prev, 
            samplesReceived: prev.samplesReceived + 1 
          } : null);
        }
        
        // Log occasionally to avoid spam
        if (sampleId % 50 === 0) {
          console.log(`Sample ${sampleId}: Acc=[${accX.toFixed(2)}, ${accY.toFixed(2)}, ${accZ.toFixed(2)}] Gyro=[${gyroX.toFixed(1)}, ${gyroY.toFixed(1)}, ${gyroZ.toFixed(1)}]`);
        }
        
      } else if (packetType === 0x03) {
        // SESSION_END packet
        console.log('🏁 Session end detected, Duration:', timestamp, 'ms, Total samples:', sampleId + 1);
        
        if (currentSession?.isActive) {
          setCurrentSession(prev => prev ? { 
            ...prev, 
            endTime: Date.now(),
            isActive: false 
          } : null);
        }
        
        setIsRecording(false);
        
        // Analyze the session data
        const analysis = analyzeGesture(sessionData);
        
        // Show session summary
        Alert.alert(
          '📊 Gesture Recording Complete!',
          `✅ Duration: ${timestamp}ms\n✅ Samples: ${sampleId + 1}\n✅ Avg Acceleration: ${analysis?.avgAccelMagnitude || 'N/A'}g\n✅ Sampling Rate: ${analysis?.samplingRate || 'N/A'}Hz`,
          [{ text: 'Great!' }]
        );
      }
      
    } catch (error) {
      console.log('Error parsing BLE data:', error);
    }
  };

  const startDeviceScan = async (existingManager?: BleManager) => {
    const bleManager = existingManager || manager;
    
    if (!bleManager) {
      setScanStatus('BLE not initialized');
      return;
    }

    try {
      setIsScanning(true);
      setScannedDevices([]); // Clear previous scan results
      setScanStatus('Checking Bluetooth state...');

      // Check if Bluetooth is powered on with retry logic
      const isBluetoothOn = await checkBluetoothState(bleManager);
      
      if (!isBluetoothOn) {
        setScanStatus('Bluetooth is not powered on');
        Alert.alert(
          'Bluetooth Required',
          'Please make sure Bluetooth is enabled in Settings.',
          [
            { text: 'Retry', onPress: () => startDeviceScan(bleManager) },
            { text: 'Cancel' }
          ]
        );
        setIsScanning(false);
        return;
      }

      setScanStatus('Scanning for Arduino device...');
      console.log('🔍 Starting BLE scan for:', DEVICE_CONFIG.name);
      console.log('🔍 Service UUID:', DEVICE_CONFIG.serviceUUID);

      let scanTimeout: NodeJS.Timeout;

      // Start scanning for devices (scan for all devices, not just specific service)
      bleManager.startDeviceScan(null, { allowDuplicates: false }, (error: any, device: any) => {
        if (error) {
          console.log('❌ Scan error:', error);
          setScanStatus(`Scan error: ${error.message}`);
          setIsScanning(false);
          return;
        }

        if (device) {
          console.log('📱 Found device:', {
            name: device.name || 'Unknown',
            id: device.id,
            rssi: device.rssi,
            serviceUUIDs: device.serviceUUIDs
          });

          // Add to scanned devices for debugging
          setScannedDevices(prev => {
            const exists = prev.find(d => d.id === device.id);
            if (!exists) {
              return [...prev, {
                name: device.name || 'Unknown',
                id: device.id,
                rssi: device.rssi,
                serviceUUIDs: device.serviceUUIDs
              }];
            }
            return prev;
          });

          // Check if this is our Arduino device by name
          if (device.name === DEVICE_CONFIG.name) {
            console.log('✅ Found Arduino device:', device.name);
            setFoundDevice(device);
            setScanStatus(`Found ${device.name}!`);
            
            // Stop scanning
            bleManager.stopDeviceScan();
            clearTimeout(scanTimeout);
            setIsScanning(false);

            // Update manager state and connect to device immediately
            setManager(bleManager);
            connectToDevice(device, bleManager);
            return;
          }

          // Also check by service UUID if name doesn't match
          if (device.serviceUUIDs && device.serviceUUIDs.includes(DEVICE_CONFIG.serviceUUID)) {
            console.log('✅ Found device with matching service UUID:', device.name || device.id);
            setFoundDevice(device);
            setScanStatus(`Found device with matching service!`);
            
            // Stop scanning
            bleManager.stopDeviceScan();
            clearTimeout(scanTimeout);
            setIsScanning(false);

            setManager(bleManager);
            connectToDevice(device, bleManager);
            return;
          }
        }
      });

      // Stop scanning after 20 seconds if device not found
      scanTimeout = setTimeout(() => {
        if (isScanning) {
          bleManager.stopDeviceScan();
          setIsScanning(false);
          
          console.log('⏰ Scan timeout. Devices found:', scannedDevices.length);
          scannedDevices.forEach(device => {
            console.log(`  - ${device.name} (${device.id}) RSSI: ${device.rssi}`);
          });
          
          if (!foundDevice) {
            setScanStatus(`Device not found. Scanned ${scannedDevices.length} devices.`);
            Alert.alert(
              '🔍 Device Not Found',
              `Could not find "AbracadabraIMU" device.\n\nScanned ${scannedDevices.length} devices.\n\nMake sure:\n• Arduino is powered on\n• Device is advertising\n• Device is nearby\n• Name matches exactly`,
              [
                { text: 'Show Debug Info', onPress: () => showDebugInfo() },
                { text: 'Retry', onPress: () => startDeviceScan(bleManager) },
                { text: 'Cancel' }
              ]
            );
          }
        }
      }, 20000);

    } catch (error) {
      console.log('❌ Error starting scan:', error);
      setScanStatus(`Error: ${error}`);
      setIsScanning(false);
    }
  };

  const showDebugInfo = () => {
    const deviceList = scannedDevices.map(device => 
      `${device.name} (RSSI: ${device.rssi})`
    ).join('\n');
    
    Alert.alert(
      'Debug Information',
      `Permissions: ${permissionsGranted ? '✅' : '❌'}\nBLE Supported: ${bleSupported ? '✅' : '❌'}\n\nDevices Found (${scannedDevices.length}):\n${deviceList || 'None'}\n\nLooking for: "${DEVICE_CONFIG.name}"\nService UUID: ${DEVICE_CONFIG.serviceUUID}`,
      [{ text: 'OK' }]
    );
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

  const clearAllData = () => {
    setSessionHistory([]);
    setTotalPacketsReceived(0);
    setCurrentSession(null);
    setLatestDataPoint(null);
    setIsRecording(false);
    setRecordingProgress(0);
  };

  const getConnectionStatusColor = () => {
    if (bleSupported === false) return '#FF5722'; // Red
    if (connectedDevice) {
      switch (connectionQuality) {
        case 'Excellent': return '#4CAF50'; // Green
        case 'Good': return '#8BC34A'; // Light Green
        case 'Poor': return '#FF9800'; // Orange
        default: return '#2196F3'; // Blue
      }
    }
    if (isConnecting) return '#FF9800'; // Orange
    if (foundDevice) return '#2196F3'; // Blue
    if (isScanning) return '#2196F3'; // Blue
    return '#FF9800'; // Orange
  };

  const getStatusIcon = () => {
    if (bleSupported === false) return '⚠️';
    if (connectedDevice) {
      if (isRecording) return '🔴'; // Recording indicator
      switch (connectionQuality) {
        case 'Excellent': return '📶';
        case 'Good': return '📶';
        case 'Poor': return '📶';
        default: return '✅';
      }
    }
    if (isConnecting) return '🔄';
    if (foundDevice) return '📱';
    if (isScanning) return '🔍';
    return '📱';
  };

  const getCurrentStatus = () => {
    if (connectedDevice) {
      if (isRecording) return `Recording... (${connectionQuality} signal)`;
      return `${connectionStatus} (${connectionQuality})`;
    }
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
      // Re-initialize BLE from scratch
      const initializeBLE = async () => {
        console.log('🚀 Re-initializing BLE...');
        setScanStatus('Re-initializing...');
        
        const permissionsOk = await requestPermissions();
        if (!permissionsOk) {
          setScanStatus('Permissions denied - cannot scan for devices');
          return;
        }

        try {
          const bleManager = new BleManager();
          setManager(bleManager);
          
          bleManager.onStateChange((state) => {
            console.log('🔵 BLE State changed to:', state);
            if (state === 'PoweredOn') {
              setBleSupported(true);
              setScanStatus('Bluetooth ready');
              setTimeout(() => {
                startDeviceScan(bleManager);
              }, 1000);
            } else {
              setBleSupported(false);
              setScanStatus(`Bluetooth state: ${state}`);
            }
          }, true);
          
        } catch (error) {
          console.log('❌ BLE re-initialization error:', error);
          setScanStatus('BLE initialization failed');
        }
      };
      
      initializeBLE();
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <Text style={styles.title}>Abracadabra App</Text>
      
      {/* Real-time Connection Status */}
      <View style={[styles.statusContainer, { backgroundColor: getConnectionStatusColor() }]}>
        <Text style={styles.statusIcon}>{getStatusIcon()}</Text>
        <Text style={styles.statusText}>{getCurrentStatus()}</Text>
      </View>

      {/* Debug Information */}
      {debugMode && (
        <View style={styles.debugContainer}>
          <Text style={styles.debugTitle}>🔧 Debug Information</Text>
          <Text style={styles.debugText}>Permissions: {permissionsGranted ? '✅ Granted' : '❌ Denied'}</Text>
          <Text style={styles.debugText}>BLE Support: {bleSupported ? '✅ Enabled' : '❌ Disabled'}</Text>
          <Text style={styles.debugText}>Devices Found: {scannedDevices.length}</Text>
          {scannedDevices.length > 0 && (
            <View style={styles.deviceList}>
              <Text style={styles.debugText}>Nearby Devices:</Text>
              {scannedDevices.slice(0, 5).map((device, index) => (
                <Text key={index} style={styles.deviceText}>
                  • {device.name} ({device.rssi}dBm)
                </Text>
              ))}
              {scannedDevices.length > 5 && (
                <Text style={styles.deviceText}>... and {scannedDevices.length - 5} more</Text>
              )}
            </View>
          )}
          <Pressable 
            style={styles.debugButton} 
            onPress={showDebugInfo}
          >
            <Text style={styles.debugButtonText}>Show Full Debug Info</Text>
          </Pressable>
        </View>
      )}

      {/* Recording Status Indicator */}
      {isRecording && (
        <View style={styles.recordingContainer}>
          <Text style={styles.recordingTitle}>🔴 RECORDING IN PROGRESS</Text>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${recordingProgress}%` }]} />
          </View>
          <Text style={styles.progressText}>{Math.round(recordingProgress)}% Complete</Text>
        </View>
      )}

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
          <Text style={styles.deviceText}>Quality: {connectionQuality}</Text>
          
          <Text 
            style={styles.disconnectButton} 
            onPress={disconnectDevice}
          >
            🔌 Disconnect
          </Text>
        </View>
      )}

      {/* Live Sensor Data Display */}
      {connectedDevice && (
        <View style={styles.dataContainer}>
          <Text style={styles.dataTitle}>📊 Live Data Stream</Text>
          
          <View style={styles.statsRow}>
            <Text style={styles.statText}>Packets: {totalPacketsReceived}</Text>
            <Text style={styles.statText}>Rate: {dataRate} Hz</Text>
            <Text style={styles.statText}>Signal: {connectionQuality}</Text>
          </View>

          {currentSession?.isActive && (
            <View style={styles.sessionInfo}>
              <Text style={styles.sessionTitle}>🎬 Active Session</Text>
              <Text style={styles.sessionText}>Hash: {currentSession.id}</Text>
              <Text style={styles.sessionText}>Samples: {currentSession.samplesReceived}</Text>
              <Text style={styles.sessionText}>Duration: {Math.round((Date.now() - currentSession.startTime) / 1000)}s</Text>
            </View>
          )}

          {latestDataPoint && (
            <View style={styles.sensorData}>
              <Text style={styles.sensorTitle}>Latest Sensor Reading:</Text>
              <View style={styles.sensorRow}>
                <Text style={styles.sensorLabel}>Accel:</Text>
                <Text style={styles.sensorValue}>
                  X: {latestDataPoint.acceleration.x.toFixed(3)}g
                </Text>
                <Text style={styles.sensorValue}>
                  Y: {latestDataPoint.acceleration.y.toFixed(3)}g
                </Text>
                <Text style={styles.sensorValue}>
                  Z: {latestDataPoint.acceleration.z.toFixed(3)}g
                </Text>
              </View>
              <View style={styles.sensorRow}>
                <Text style={styles.sensorLabel}>Gyro:</Text>
                <Text style={styles.sensorValue}>
                  X: {latestDataPoint.gyroscope.x.toFixed(1)}°/s
                </Text>
                <Text style={styles.sensorValue}>
                  Y: {latestDataPoint.gyroscope.y.toFixed(1)}°/s
                </Text>
                <Text style={styles.sensorValue}>
                  Z: {latestDataPoint.gyroscope.z.toFixed(1)}°/s
                </Text>
              </View>
            </View>
          )}
        </View>
      )}

      {/* Session History */}
      {sessionHistory.length > 0 && (
        <View style={styles.historyContainer}>
          <Text style={styles.historyTitle}>📚 Recent Sessions</Text>
          
          {sessionHistory.slice(0, 3).map((session, index) => (
            <View key={session.id} style={styles.historyItem}>
              <Text style={styles.historyText}>
                Session {index + 1}: {session.samplesReceived} samples
              </Text>
              <Text style={styles.historySubtext}>
                {session.endTime ? 
                  `Duration: ${((session.endTime - session.startTime) / 1000).toFixed(1)}s` : 
                  'Active'
                } | Hash: {session.id}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* Clear Data Button */}
      <Pressable style={styles.clearButton} onPress={clearAllData}>
        <Text style={styles.clearButtonText}>🗑️ Clear All Data</Text>
      </Pressable>

      <View style={styles.instructions}>
        <Text style={styles.instructionText}>
          {bleSupported === false 
            ? '🔧 Create development build to use Bluetooth'
            : connectedDevice 
              ? isRecording
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
        <Text style={styles.configTitle}>Configuration:</Text>
        <Text style={styles.configText}>Device: {DEVICE_CONFIG.name}</Text>
        <Text style={styles.configText}>Data Storage: React State (Option A)</Text>
        <Text style={styles.configText}>Real-time Updates: Enabled</Text>
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
  recordingContainer: {
    backgroundColor: '#4a1a1a',
    padding: 15,
    borderRadius: 10,
    marginBottom: 20,
    minWidth: 300,
    borderWidth: 2,
    borderColor: '#FF5722',
  },
  recordingTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FF5722',
    textAlign: 'center',
    marginBottom: 10,
  },
  progressBar: {
    height: 8,
    backgroundColor: '#2a1a1a',
    borderRadius: 4,
    marginBottom: 8,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#FF5722',
    borderRadius: 4,
  },
  progressText: {
    fontSize: 12,
    color: '#FF5722',
    textAlign: 'center',
    fontWeight: 'bold',
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
  analysisContainer: {
    backgroundColor: '#1a2a2a',
    padding: 15,
    borderRadius: 10,
    marginBottom: 20,
    minWidth: 300,
    borderWidth: 1,
    borderColor: '#9C27B0',
  },
  analysisTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#9C27B0',
    marginBottom: 10,
    textAlign: 'center',
  },
  analysisItem: {
    backgroundColor: '#2a1a2a',
    padding: 10,
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#9C27B0',
  },
  analysisHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  analysisSessionText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#ECEDEE',
  },
  intensityBadge: {
    fontSize: 10,
    color: 'white',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    fontWeight: 'bold',
  },
  analysisStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  analysisText: {
    fontSize: 11,
    color: '#9BA1A6',
    fontFamily: 'monospace',
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
    backgroundColor: '#FF5722',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginVertical: 8,
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
  clearButtonText: {
    fontSize: 12,
    color: '#ECEDEE',
    fontWeight: 'bold',
  },
  debugContainer: {
    backgroundColor: '#1E1E1E',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#333333',
    minWidth: 300,
  },
  debugTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 12,
    textAlign: 'center',
  },
  debugText: {
    fontSize: 14,
    color: '#CCCCCC',
    marginBottom: 4,
  },
  deviceList: {
    marginTop: 8,
    paddingLeft: 8,
  },
  debugButton: {
    backgroundColor: '#0066CC',
    padding: 8,
    borderRadius: 6,
    marginTop: 8,
    alignItems: 'center',
  },
  debugButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
});
