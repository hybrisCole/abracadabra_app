import React, { useEffect, useState } from 'react';
import { StyleSheet, Alert, Platform } from 'react-native';
import { Text, View } from '@/components/Themed';

// Arduino device configuration
const DEVICE_CONFIG = {
  name: "AbracadabraIMU",
  serviceUUID: "8cfc8e26-0682-4f72-b0c0-c0c8e0b12a06",
  dataCharacteristicUUID: "780fe2ec-c87c-443e-bf01-78918d9d625b",
  commandCharacteristicUUID: "aa7e97b4-d7dc-4cb0-9fef-85875036520e"
};

export default function TabOneScreen() {
  const [bleSupported, setBleSupported] = useState<boolean | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [foundDevice, setFoundDevice] = useState<any>(null);
  const [scanStatus, setScanStatus] = useState('Initializing Bluetooth...');
  const [manager, setManager] = useState<any>(null);

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

          // Show alert with device information
          Alert.alert(
            '🎯 Arduino Device Found!',
            `Device: ${device.name}\nMAC Address: ${device.id}\nRSSI: ${device.rssi} dBm`,
            [
              {
                text: 'Great!',
                onPress: () => console.log('User acknowledged device found')
              }
            ]
          );
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

  const getStatusColor = () => {
    if (bleSupported === false) return '#FF5722'; // Red
    if (foundDevice) return '#4CAF50'; // Green
    if (isScanning) return '#2196F3'; // Blue
    return '#FF9800'; // Orange
  };

  const getStatusIcon = () => {
    if (bleSupported === false) return '⚠️';
    if (foundDevice) return '✅';
    if (isScanning) return '🔍';
    return '📱';
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
    <View style={styles.container}>
      <Text style={styles.title}>Abracadabra App</Text>
      
      <View style={[styles.statusContainer, { backgroundColor: getStatusColor() }]}>
        <Text style={styles.statusIcon}>{getStatusIcon()}</Text>
        <Text style={styles.statusText}>{scanStatus}</Text>
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

      {!isScanning && !foundDevice && bleSupported && (
        <View style={styles.retryContainer}>
          <Text 
            style={styles.retryButton} 
            onPress={retryScanning}
          >
            🔄 Retry Scanning
          </Text>
        </View>
      )}

      {foundDevice && (
        <View style={styles.deviceInfo}>
          <Text style={styles.deviceTitle}>Connected Device:</Text>
          <Text style={styles.deviceText}>Name: {foundDevice.name}</Text>
          <Text style={styles.deviceText}>MAC: {foundDevice.id}</Text>
          <Text style={styles.deviceText}>Signal: {foundDevice.rssi} dBm</Text>
        </View>
      )}

      <View style={styles.instructions}>
        <Text style={styles.instructionText}>
          {bleSupported === false 
            ? '🔧 Create development build to use Bluetooth'
            : foundDevice 
              ? '🎉 Your Arduino is ready for gestures!' 
              : '⚡ Power on your Arduino device to connect'
          }
        </Text>
      </View>

      <View style={styles.configInfo}>
        <Text style={styles.configTitle}>Looking for:</Text>
        <Text style={styles.configText}>Device: {DEVICE_CONFIG.name}</Text>
        <Text style={styles.configText}>MAC: d9:1e:41:f7:f1:c6</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
