import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';

interface IMUData {
  acceleration: { x: number; y: number; z: number };
  gyroscope: { x: number; y: number; z: number };
}

interface IMUCubeVisualizationProps {
  imuData: IMUData | null;
  style?: any;
}

export default function IMUCubeVisualization({ imuData, style }: IMUCubeVisualizationProps) {
  const [accScale, setAccScale] = useState(0.2);
  const [gyroScale, setGyroScale] = useState(0.0015);

  return (
    <View style={[styles.container, style]}>
      <View style={styles.header}>
        <Text style={styles.title}>📦 3D IMU Cube Visualization</Text>
        <Text style={styles.subtitle}>Ready for implementation</Text>
      </View>
      
      <View style={styles.controls}>
        <View style={styles.controlRow}>
          <Text style={styles.controlLabel}>Acceleration Scale:</Text>
          <TextInput
            style={styles.controlInput}
            value={accScale.toString()}
            onChangeText={(text) => {
              const value = parseFloat(text);
              if (!isNaN(value) && value >= 0.01 && value <= 10) {
                setAccScale(value);
              }
            }}
            keyboardType="numeric"
            placeholder="0.2"
          />
        </View>
        
        <View style={styles.controlRow}>
          <Text style={styles.controlLabel}>Gyroscope Scale:</Text>
          <TextInput
            style={styles.controlInput}
            value={gyroScale.toString()}
            onChangeText={(text) => {
              const value = parseFloat(text);
              if (!isNaN(value) && value >= 0.0001 && value <= 0.1) {
                setGyroScale(value);
              }
            }}
            keyboardType="numeric"
            placeholder="0.0015"
          />
        </View>
      </View>

      <View style={styles.placeholderContainer}>
        <Text style={styles.placeholderText}>3D Cube Placeholder</Text>
        <Text style={styles.placeholderSubtext}>Ready for 3D implementation</Text>
      </View>
      
      <View style={styles.legend}>
        <Text style={styles.legendText}>🔴 X-axis (Roll) | 🟢 Y-axis (Pitch) | 🔵 Z-axis (Yaw)</Text>
        <Text style={styles.instructionText}>
          Cube will rotate with gyroscope and move with acceleration
        </Text>
        {imuData && (
          <View style={styles.dataContainer}>
            <Text style={styles.dataText}>
              Acc: X:{imuData.acceleration.x.toFixed(2)} Y:{imuData.acceleration.y.toFixed(2)} Z:{imuData.acceleration.z.toFixed(2)}
            </Text>
            <Text style={styles.dataText}>
              Gyro: X:{imuData.gyroscope.x.toFixed(1)} Y:{imuData.gyroscope.y.toFixed(1)} Z:{imuData.gyroscope.z.toFixed(1)}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1E2328',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#FF3333',
    minWidth: 300,
  },
  header: {
    marginBottom: 12,
    alignItems: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FF3333',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 10,
    color: '#999999',
    textAlign: 'center',
    marginTop: 2,
    fontStyle: 'italic',
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 10,
  },
  controlRow: {
    flex: 1,
    alignItems: 'center',
  },
  controlLabel: {
    fontSize: 12,
    color: '#CCCCCC',
    marginBottom: 4,
    textAlign: 'center',
  },
  controlInput: {
    backgroundColor: '#2A2A2A',
    color: '#FFFFFF',
    padding: 6,
    borderRadius: 4,
    fontSize: 12,
    textAlign: 'center',
    borderWidth: 1,
    borderColor: '#555555',
    minWidth: 80,
  },
  placeholderContainer: {
    height: 220,
    marginBottom: 12,
    borderRadius: 8,
    backgroundColor: '#2A2A2A',
    borderWidth: 1,
    borderColor: '#333333',
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderText: {
    fontSize: 16,
    color: '#666666',
    fontWeight: 'bold',
  },
  placeholderSubtext: {
    fontSize: 12,
    color: '#555555',
    marginTop: 4,
    fontStyle: 'italic',
  },
  legend: {
    alignItems: 'center',
  },
  legendText: {
    fontSize: 10,
    color: '#CCCCCC',
    textAlign: 'center',
    marginBottom: 2,
  },
  instructionText: {
    fontSize: 9,
    color: '#999999',
    textAlign: 'center',
    marginBottom: 6,
    fontStyle: 'italic',
  },
  dataContainer: {
    alignItems: 'center',
  },
  dataText: {
    fontSize: 8,
    color: '#999999',
    textAlign: 'center',
    fontFamily: 'monospace',
    marginBottom: 1,
  },
}); 