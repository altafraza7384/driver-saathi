import { setGlobalOptions } from "firebase-functions/v2";

// Cap concurrent instances for every function (usage caps, so one user or a
// runaway cannot drain the AI/billing budget). 10 is plenty for the current
// scale; raise it when real traffic grows. Per-function options (region,
// secrets, timeout) still apply on top of this global cap.
setGlobalOptions({ maxInstances: 10 });
