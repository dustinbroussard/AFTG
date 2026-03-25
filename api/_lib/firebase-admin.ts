import { initializeApp, getApps, cert, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

const FIREBASE_PROJECT_ID = 'ai-studio-applet-webapp-a549d';
const FIRESTORE_DATABASE_ID = 'ai-studio-5d62c22c-0318-44b3-a976-ecfe921b8e12';

/**
 * Initializes the Firebase Admin SDK if it hasn't been initialized yet.
 * Follows best practices for serverless environments (like Vercel/Next.js).
 */
export function initAdmin(): App {
  if (getApps().length === 0) {
    const serviceAccount = getServiceAccount();
    
    if (serviceAccount) {
      return initializeApp({
        credential: cert(serviceAccount),
        projectId: FIREBASE_PROJECT_ID,
        databaseURL: `https://${FIREBASE_PROJECT_ID}.firebaseio.com`,
      });
    } else {
      // Fallback to Application Default Credentials (ADC)
      // Recommended for production environments (Google Cloud, Vercel with env vars)
      return initializeApp({
        projectId: FIREBASE_PROJECT_ID,
        databaseURL: `https://${FIREBASE_PROJECT_ID}.firebaseio.com`,
      });
    }
  }
  return getApps()[0];
}

/**
 * Returns a Firestore instance for the specific named database used by this app.
 */
export function getAdminDb(): Firestore {
  initAdmin();
  return getFirestore(FIRESTORE_DATABASE_ID);
}

export function getAdminAuth(): Auth {
  return getAuth(initAdmin());
}

function getServiceAccount() {
  // 1. Check for service account JSON in environment variable
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
      return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    } catch (e) {
      console.error('Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON:', e);
    }
  }

  // 2. Local development: You might have GOOGLE_APPLICATION_CREDENTIALS set to a path
  // However, for this project, we explicitly handle the named database.
  
  return null;
}
