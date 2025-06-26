import { API_CONFIG, API_URLS } from '@/constants/API';
import { Alert } from 'react-native';

export interface IMUDataPoint {
  rel_timestamp: number;
  recording_id: string;
  acc_x: number;
  acc_y: number;
  acc_z: number;
  gyro_x: number;
  gyro_y: number;
  gyro_z: number;
}

export interface PredictionResponse {
  // Legacy fields for backward compatibility
  prediction?: string;
  confidence?: number;
  model_used?: string;
  processing_time?: number;
  timestamp?: string;
  
  // New detailed response format
  all_detected_movements: { [key: string]: number };
  significant_movements: { [key: string]: number };
  detailed_segments: Array<{
    movement: string;
    avg_confidence: number;
    duration: number;
    start_time: number;
    end_time: number;
    window_count: number;
  }>;
  auto_learning?: Array<{
    action: string;
    confidence: number;
    detection_id: string;
    predicted_movement: string;
  }>;
  raw_window_predictions: {
    predictions: string[];
    confidences: number[];
    smoothed_predictions: string[];
    times: number[];
  };
  still_phases: number;
  window_params: {
    overlap_ms: number;
    sample_rate_hz: number;
    window_size_ms: number;
  };
}

export interface ModelStatusResponse {
  model_loaded: boolean;
  model_type: string;
  training_samples: number;
  last_trained: string;
  available_gestures: string[];
}

export interface TrainingResponse {
  success: boolean;
  message: string;
  model_updated: boolean;
  training_samples: number;
  accuracy_score?: number;
}

export class GestureAPI {
  private static async makeRequest<T>(
    url: string, 
    options: RequestInit = {}
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_CONFIG.TIMEOUT);

    try {
      console.log('🌐 Making request to:', url);
      console.log('🔧 Request options:', {
        method: options.method || 'GET',
        headers: options.headers || {},
        bodyType: options.body ? typeof options.body : 'none',
        bodySize: options.body ? 
          (options.body instanceof FormData ? 'FormData' : 
           typeof options.body === 'string' ? options.body.length + ' chars' : 
           'unknown') : 'none'
      });

      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          ...options.headers,
        },
      });

      clearTimeout(timeoutId);

      console.log('📡 Response status:', response.status);
      console.log('📡 Response headers:', Object.fromEntries(response.headers.entries()));

      if (!response.ok) {
        // Try to get the error body for more details
        let errorBody = '';
        try {
          errorBody = await response.text();
          console.error('📄 Error response body:', errorBody);
        } catch (e) {
          console.error('📄 Could not read error body:', e);
        }
        
        throw new Error(`HTTP error! status: ${response.status}, body: ${errorBody}`);
      }

      const result = await response.json();
      console.log('✅ Request successful, response:', result);
      return result;
      
    } catch (error) {
      clearTimeout(timeoutId);
      console.error('💥 Request failed:', error);
      
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Request timeout');
      }
      throw error;
    }
  }

  /**
   * Convert IMU data array to CSV format string
   */
  private static convertToCSV(data: IMUDataPoint[]): string {
    if (data.length === 0) {
      return '';
    }

    // CSV header
    const header = 'rel_timestamp,recording_id,acc_x,acc_y,acc_z,gyro_x,gyro_y,gyro_z';
    
    // CSV rows
    const rows = data.map(point => 
      `${point.rel_timestamp},${point.recording_id},${point.acc_x},${point.acc_y},${point.acc_z},${point.gyro_x},${point.gyro_y},${point.gyro_z}`
    );

    return [header, ...rows].join('\n');
  }

  /**
   * Get the health status of the API
   */
  static async getHealth(): Promise<any> {
    return this.makeRequest(API_URLS.health);
  }

  /**
   * Get the current model status
   */
  static async getModelStatus(): Promise<ModelStatusResponse> {
    return this.makeRequest(API_URLS.modelStatus);
  }

  /**
   * Predict gesture from IMU data
   */
  static async predictGesture(data: IMUDataPoint[]): Promise<PredictionResponse> {
    try {
      console.log('🚀 Starting gesture prediction...');
      console.log('Input data points:', data.length);
      
      // Convert IMU data to CSV format
      const csvData = this.convertToCSV(data);
      
      console.log('📝 CSV conversion completed');
      console.log('CSV length:', csvData.length, 'characters');
      
      // Debug: Check for any invalid values
      const invalidPoints = data.filter(point => 
        isNaN(point.rel_timestamp) || 
        isNaN(point.acc_x) || isNaN(point.acc_y) || isNaN(point.acc_z) ||
        isNaN(point.gyro_x) || isNaN(point.gyro_y) || isNaN(point.gyro_z) ||
        !point.recording_id
      );
      
      if (invalidPoints.length > 0) {
        console.error('❌ Found invalid data points:', invalidPoints.length);
        console.error('First invalid point:', invalidPoints[0]);
        throw new Error(`Invalid data points found: ${invalidPoints.length}`);
      }
      
      // Debug: Show sample data points
      console.log('Sample data points:');
      console.log('First point:', data[0]);
      console.log('Last point:', data[data.length - 1]);
      
      // Debug: Show first few CSV lines
      const csvLines = csvData.split('\n');
      console.log('CSV header:', csvLines[0]);
      console.log('First CSV row:', csvLines[1]);
      console.log('Last CSV row:', csvLines[csvLines.length - 1]);
      
      // Use FormData as the server expects form data
      const formData = new FormData();
      formData.append('csv_data', csvData);

      console.log('📤 Sending request to API...');
      
      return this.makeRequest(API_URLS.predict, {
        method: 'POST',
        body: formData,
      });
      
    } catch (error) {
      console.error('💥 Error in predictGesture:', error);
      throw error;
    }
  }

  /**
   * Train the model with new gesture data
   */
  static async trainModel(): Promise<TrainingResponse> {
    return this.makeRequest(API_URLS.train, {
      method: 'POST',
    });
  }

  /**
   * Convert BLE data to API format
   */
  static convertBLEDataToAPI(
    bleData: any[], 
    recordingId: string
  ): IMUDataPoint[] {
    // Convert hex recording ID to server-expected format
    // Server expects format like "g_12601398_9595"
    const timestamp = Date.now();
    const formattedRecordingId = `g_${timestamp}_${recordingId}`;
    
    return bleData.map((point, index) => ({
      rel_timestamp: point.timestamp || index * 4, // 4ms intervals (250Hz)
      recording_id: formattedRecordingId,
      acc_x: point.acceleration?.x || 0,
      acc_y: point.acceleration?.y || 0,
      acc_z: point.acceleration?.z || 0,
      gyro_x: point.gyroscope?.x || 0,
      gyro_y: point.gyroscope?.y || 0,
      gyro_z: point.gyroscope?.z || 0,
    }));
  }

  /**
   * Test API connectivity
   */
  static async testConnection(): Promise<boolean> {
    try {
      await this.getHealth();
      return true;
    } catch (error) {
      console.error('API connection test failed:', error);
      return false;
    }
  }

  /**
   * Analyze a gesture session and show the results
   */
  static async analyzeGesture(
    sessionData: IMUDataPoint[], 
    setIsAnalyzing?: (analyzing: boolean) => void,
    setLastResult?: (result: string) => void
  ): Promise<void> {
    try {
      console.log('🔍 Analyzing gesture data with ML model...');
      console.log(`📊 Sending ${sessionData.length} data points to API`);
      
      console.log('🔧 DEBUG: About to call predictGesture');
      console.log('🔧 DEBUG: First data point:', sessionData[0]);
      console.log('🔧 DEBUG: Last data point:', sessionData[sessionData.length - 1]);
      
      // Set analyzing state
      setIsAnalyzing?.(true);
      
      // Start analysis
      const startTime = Date.now();
      console.log('🔧 DEBUG: Calling predictGesture now...');
      const prediction = await this.predictGesture(sessionData);
      console.log('🔧 DEBUG: predictGesture returned:', prediction);
      const endTime = Date.now();
      
      console.log('✅ Analysis complete:', prediction);
      
      // Process the new detailed response format
      const processingTime = endTime - startTime;
      
      // Extract main gesture information
      const detectedMovements = Object.entries(prediction.significant_movements || {})
        .map(([movement, count]) => `${movement}: ${count}`)
        .join(', ');
      
      // Get the highest confidence movement
      const primaryMovement = prediction.detailed_segments?.length > 0 
        ? prediction.detailed_segments.reduce((prev, current) => 
            prev.avg_confidence > current.avg_confidence ? prev : current
          )
        : null;
      
      const mainPrediction = primaryMovement?.movement || 'unknown';
      const mainConfidence = primaryMovement?.avg_confidence || 0;
      
      // Create a detailed results message
      const resultMessage = `🎯 Gesture Analysis Results\n\n` +
        `🏆 Primary Movement: ${mainPrediction}\n` +
        `📊 Confidence: ${(mainConfidence * 100).toFixed(1)}%\n` +
        `🔢 All Movements: ${detectedMovements || 'none detected'}\n` +
        `⏱️ Processing Time: ${processingTime}ms\n` +
        `📈 Data Points: ${sessionData.length}\n` +
        `🕒 Analysis Time: ${new Date().toLocaleTimeString()}\n\n` +
        `💡 Detected ${prediction.detailed_segments?.length || 0} movement segments`;
      
      // Update result state with primary movement
      setLastResult?.(mainPrediction);
      setIsAnalyzing?.(false);
      
      // Show results to user
      Alert.alert(
        '🧠 ML Analysis Complete',
        resultMessage,
        [
          { 
            text: 'Great!', 
            style: 'default' 
          }
        ]
      );
      
      // Log detailed results for debugging
      console.log('📋 Detailed Analysis Results:');
      console.log(`  Primary Movement: ${mainPrediction}`);
      console.log(`  Primary Confidence: ${(mainConfidence * 100).toFixed(2)}%`);
      console.log(`  All Movements:`, prediction.significant_movements);
      console.log(`  Segments:`, prediction.detailed_segments?.length || 0);
      console.log(`  API Response Time: ${processingTime}ms`);
      console.log(`  Data Points Sent: ${sessionData.length}`);
      console.log(`  Auto Learning:`, prediction.auto_learning?.length || 0, 'suggestions');
      
    } catch (error) {
      console.error('❌ Gesture analysis failed:', error);
      console.error('🔧 DEBUG: Full error object:', JSON.stringify(error, null, 2));
      console.error('🔧 DEBUG: Error name:', error instanceof Error ? error.name : 'unknown');
      console.error('🔧 DEBUG: Error message:', error instanceof Error ? error.message : 'unknown');
      console.error('🔧 DEBUG: Error stack:', error instanceof Error ? error.stack : 'unknown');
      
      // Reset analyzing state
      setIsAnalyzing?.(false);
      setLastResult?.('Analysis failed');
      
      // Show user-friendly error message
      Alert.alert(
        '❌ Analysis Failed',
        `Could not analyze gesture:\n${error instanceof Error ? error.message : 'Unknown error'}\n\nPlease check your internet connection and try again.`,
        [
          { text: 'OK', style: 'cancel' }
        ]
      );
    }
  }
}

export default GestureAPI; 