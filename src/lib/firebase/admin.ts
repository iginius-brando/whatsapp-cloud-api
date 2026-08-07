import "server-only";

import {
  getApps,
  initializeApp,
  applicationDefault,
  cert,
  type App,
} from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

/** Il tipo Bucket arriva da @google-cloud/storage, che è una dipendenza
 *  transitiva di firebase-admin: lo deriviamo invece di importarlo. */
type MediaBucket = ReturnType<ReturnType<typeof getStorage>["bucket"]>;

/**
 * Inizializza l'Admin SDK una sola volta.
 *
 * - Su Firebase App Hosting (Cloud Run) le Application Default Credentials del
 *   service account sono già disponibili: non serve alcuna chiave.
 * - In locale imposta GOOGLE_APPLICATION_CREDENTIALS con il percorso del file
 *   JSON del service account, oppure fornisci FIREBASE_SERVICE_ACCOUNT (JSON
 *   inline) come variabile d'ambiente.
 */
function initAdminApp(): App {
  if (getApps().length) {
    return getApps()[0];
  }

  const inlineServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (inlineServiceAccount) {
    return initializeApp({
      credential: cert(JSON.parse(inlineServiceAccount)),
    });
  }

  return initializeApp({
    credential: applicationDefault(),
  });
}

const adminApp = initAdminApp();

export const adminAuth: Auth = getAuth(adminApp);
export const adminDb: Firestore = getFirestore(adminApp);

/**
 * Bucket dove archiviamo gli allegati. È lo stesso bucket di default del
 * progetto Firebase: il nome arriva dalla config pubblica, quindi non serve
 * un'altra variabile d'ambiente in produzione.
 */
export function mediaBucket(): MediaBucket {
  const name =
    process.env.FIREBASE_STORAGE_BUCKET ||
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;

  if (!name) {
    throw new Error(
      "Bucket non configurato: imposta NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
    );
  }

  return getStorage(adminApp).bucket(name);
}
