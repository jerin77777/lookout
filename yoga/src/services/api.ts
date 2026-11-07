import { Platform } from 'react-native';
import { ArriClient } from './arri_client.rpc';

const getBaseUrl = () => {
  const envUrl = process.env.BACKEND_URL;
  if (envUrl) {
    return envUrl;
  }

  if (Platform.OS === 'web') {
    // If the browser page is loaded from another host, use that; otherwise local server
    if (typeof window !== 'undefined' && window.location && window.location.hostname) {
      return `http://${window.location.hostname}:5000`;
    }
    return 'http://localhost:5000';
  }
  // Android emulator host loopback address
  return 'http://10.0.2.2:5000';
};


export const BACKEND_URL = getBaseUrl();

export const api = new ArriClient({
  baseUrl: BACKEND_URL,
});

export const arriClient = api;

