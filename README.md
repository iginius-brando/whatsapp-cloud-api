# WhatsApp Cloud API

## Firebase App Hosting troubleshooting

If Firebase App Hosting fails during build with an error like:

```text
package.json not found
ERROR: No buildpack groups passed detection.
```

check the `GitCommit` line in the Cloud Build log first. In the failing build observed on 2026-07-20, Firebase built commit `514b2a1f7bb349ca758cb94ff9e9d5a3f2d0c3c3`, the initial repository commit, which does not contain a Node/Next.js app or a `package.json` file.

Before re-running the deployment, verify that App Hosting is connected to the branch and root directory that contain the app files:

- `package.json`
- `next.config.ts` or `next.config.js`
- `apphosting.yaml`
- the app source directory

If those files are missing from the branch Firebase builds, App Hosting cannot detect the framework and the build will fail before installing dependencies.

### Fix checklist

1. Push or merge the app code into the branch connected to Firebase App Hosting.
2. Confirm the App Hosting backend uses the repository root that contains `package.json`.
3. Re-run the Firebase App Hosting deployment.
4. In the new build log, confirm that `GitCommit` points to the commit containing the app files.
