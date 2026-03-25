import 'dotenv/config';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { runQuestionPipeline } from '../generate-questions.js';
import { getPlayableCategories, TriviaQuestion } from '../../src/types.js';
import { QUESTION_COLLECTION } from '../../src/services/questionCollections.js';

// Configuration
const REPLENISH_THRESHOLD = 20;
const REPLENISH_BATCH_SIZE = 10;
const FIRESTORE_DATABASE_ID = 'ai-studio-5d62c22c-0318-44b3-a976-ecfe921b8e12';
const FIREBASE_PROJECT_ID = 'ai-studio-applet-webapp-a549d';

// Initialize Firebase Admin
function getServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
      return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    } catch (e) {
      return null;
    }
  }
  return null;
}

function initAdmin() {
  if (getApps().length === 0) {
    const serviceAccount = getServiceAccount();
    if (serviceAccount) {
      initializeApp({
        credential: cert(serviceAccount),
        projectId: FIREBASE_PROJECT_ID,
      });
    } else {
      // Fallback to application default credentials
      initializeApp({
        projectId: FIREBASE_PROJECT_ID,
      });
    }
  }
  return getFirestore(FIRESTORE_DATABASE_ID);
}

const db = initAdmin();

async function getExistingQuestions(category: string): Promise<{ category: string; question: string }[]> {
  const snapshot = await db.collection(QUESTION_COLLECTION)
    .where('category', '==', category)
    .orderBy('createdAt', 'desc')
    .limit(20)
    .get();

  return snapshot.docs.map(doc => ({
    category: doc.get('category'),
    question: doc.get('question'),
  }));
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export default async function handler(req: any, res: any) {
  // Basic security: Check for an auth header or just allow for now if it's internal
  // In a real app, you'd use a secret token
  const authHeader = req.headers['x-maintenance-token'];
  const secretToken = process.env.MAINTENANCE_TOKEN;
  
  if (secretToken && authHeader !== secretToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const results: any[] = [];
  const categories = getPlayableCategories();
  const difficulties: ('easy' | 'medium' | 'hard')[] = ['easy', 'medium', 'hard'];

  const requestId = `topup-${Date.now()}`;
  const requestUrl = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host || ''}`;

  console.info(`[top-up] Starting replenishment for ${categories.length} categories...`);

  for (const category of categories) {
    for (const difficulty of difficulties) {
      try {
        // 1. Check current inventory
        const snapshot = await db.collection(QUESTION_COLLECTION)
          .where('category', '==', category)
          .where('difficulty', '==', difficulty)
          .where('validationStatus', '==', 'approved')
          .count()
          .get();

        const count = snapshot.data().count;
        
        if (count < REPLENISH_THRESHOLD) {
          console.info(`[top-up] Replenishing ${category}/${difficulty}: current count ${count} < ${REPLENISH_THRESHOLD}`);
          
          // 2. Fetch existing questions for deduplication
          const existingQuestions = await getExistingQuestions(category);
          
          // 3. Trigger pipeline
          const context = {
            requestId: `${requestId}-${category}-${difficulty}`,
            startedAt: Date.now(),
          };

          const newQuestions = await runQuestionPipeline({
            categories: [category],
            countPerCategory: REPLENISH_BATCH_SIZE,
            existingQuestions,
            requestedDifficulty: difficulty,
            requestUrl,
            context,
          });

          if (newQuestions.length > 0) {
            // 4. Store in Firestore
            const batch = db.batch();
            for (const q of newQuestions) {
              const docRef = db.collection(QUESTION_COLLECTION).doc(q.id || `gen-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
              batch.set(docRef, {
                ...q,
                validationStatus: 'approved', // Force approved status for bank replenishment
                createdAt: Date.now(),
                usedCount: 0,
                used: false,
              });
            }
            await batch.commit();
            
            console.info(`[top-up] Successfully added ${newQuestions.length} questions to ${category}/${difficulty}`);
            results.push({ category, difficulty, added: newQuestions.length, status: 'replenished' });
            
            // 5. Stagger requests to avoid Gemini rate limits
            await sleep(2000); 
          } else {
            console.warn(`[top-up] Pipeline returned 0 questions for ${category}/${difficulty}`);
            results.push({ category, difficulty, added: 0, status: 'pipeline_empty' });
          }
        } else {
          results.push({ category, difficulty, count, status: 'sufficient' });
        }
      } catch (error) {
        console.error(`[top-up] Error replenishing ${category}/${difficulty}:`, error);
        results.push({ category, difficulty, error: error instanceof Error ? error.message : String(error), status: 'error' });
      }
    }
  }

  return res.status(200).json({
    message: 'Maintenance top-up completed',
    requestId,
    results,
  });
}
