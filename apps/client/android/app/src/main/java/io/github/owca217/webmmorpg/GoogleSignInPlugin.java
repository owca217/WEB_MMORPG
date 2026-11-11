package io.github.owca217.webmmorpg;

import android.app.Activity;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;
import androidx.core.content.ContextCompat;
import androidx.credentials.ClearCredentialStateRequest;
import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.CustomCredential;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.exceptions.ClearCredentialException;
import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.exceptions.GetCredentialException;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;
import java.lang.ref.WeakReference;

@CapacitorPlugin(name = "GoogleSignIn")
public class GoogleSignInPlugin extends Plugin {
    private static final String CANCELLED = "GOOGLE_CANCELLED";
    private static final String UNAVAILABLE = "GOOGLE_UNAVAILABLE";
    private static final String INVALID_RESPONSE = "GOOGLE_INVALID_RESPONSE";

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    // Request entry points, provider callbacks and Activity destruction all settle on the main thread.
    private final OperationGate<PendingOperation> operations = new OperationGate<>();

    @PluginMethod
    public void signIn(PluginCall call) {
        mainHandler.post(() -> startSignIn(call));
    }

    @PluginMethod
    public void signOut(PluginCall call) {
        mainHandler.post(() -> startSignOut(call));
    }

    private void startSignIn(PluginCall call) {
        Activity activity = availableActivity(call);
        if (activity == null) return;

        String clientId = call.getString("clientId");
        String nonce = call.getString("nonce");
        if (clientId == null || clientId.trim().isEmpty() || nonce == null || nonce.trim().isEmpty()) {
            reject(call, INVALID_RESPONSE);
            return;
        }

        PendingOperation operation = new PendingOperation(call, true);
        if (!operations.begin(operation)) {
            reject(call, UNAVAILABLE);
            return;
        }

        try {
            GetSignInWithGoogleOption option = new GetSignInWithGoogleOption.Builder(clientId)
                .setNonce(nonce)
                .build();
            GetCredentialRequest request = new GetCredentialRequest.Builder().addCredentialOption(option).build();
            CredentialManager.create(activity.getApplicationContext()).getCredentialAsync(
                activity,
                request,
                operation.cancellationSignal,
                ContextCompat.getMainExecutor(activity.getApplicationContext()),
                new SignInCallback(this, operation)
            );
        } catch (IllegalArgumentException ignored) {
            cancelAndReject(operation, INVALID_RESPONSE);
        } catch (RuntimeException ignored) {
            cancelAndReject(operation, UNAVAILABLE);
        }
    }

    private void startSignOut(PluginCall call) {
        Activity activity = availableActivity(call);
        if (activity == null) return;

        PendingOperation pending = operations.current();
        if (pending != null) {
            if (!pending.signIn) {
                reject(call, UNAVAILABLE);
                return;
            }
            // Logout invalidates a pending token before clearing provider state.
            cancelAndReject(pending, CANCELLED);
        }

        PendingOperation operation = new PendingOperation(call, false);
        if (!operations.begin(operation)) {
            reject(call, UNAVAILABLE);
            return;
        }

        try {
            CredentialManager.create(activity.getApplicationContext()).clearCredentialStateAsync(
                new ClearCredentialStateRequest(),
                operation.cancellationSignal,
                ContextCompat.getMainExecutor(activity.getApplicationContext()),
                new SignOutCallback(this, operation)
            );
        } catch (RuntimeException ignored) {
            cancelAndReject(operation, UNAVAILABLE);
        }
    }

    private Activity availableActivity(PluginCall call) {
        if (operations.isDestroyed()) {
            reject(call, CANCELLED);
            return null;
        }
        Activity activity = getActivity();
        if (activity == null || activity.isFinishing() || activity.isDestroyed()) {
            reject(call, UNAVAILABLE);
            return null;
        }
        return activity;
    }

    private void signInResult(PendingOperation operation, GetCredentialResponse response) {
        PluginCall call = finish(operation);
        if (call == null) return;

        Activity activity = getActivity();
        if (activity == null || activity.isFinishing() || activity.isDestroyed()) {
            reject(call, CANCELLED);
            return;
        }

        try {
            Credential credential = response == null ? null : response.getCredential();
            if (!(credential instanceof CustomCredential) ||
                !GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL.equals(credential.getType())) {
                reject(call, INVALID_RESPONSE);
                return;
            }

            String idToken = GoogleIdTokenCredential.createFrom(credential.getData()).getIdToken();
            if (idToken == null || idToken.trim().isEmpty()) {
                reject(call, INVALID_RESPONSE);
                return;
            }
            JSObject result = new JSObject();
            result.put("idToken", idToken);
            call.resolve(result);
        } catch (Exception ignored) {
            // Provider exceptions may contain credential data: never log or forward them.
            reject(call, INVALID_RESPONSE);
        }
    }

    private void signInError(PendingOperation operation, GetCredentialException error) {
        PluginCall call = finish(operation);
        if (call != null) {
            reject(call, error instanceof GetCredentialCancellationException ? CANCELLED : UNAVAILABLE);
        }
    }

    private void signOutResult(PendingOperation operation) {
        PluginCall call = finish(operation);
        if (call != null) call.resolve();
    }

    private void signOutError(PendingOperation operation, ClearCredentialException error) {
        PluginCall call = finish(operation);
        if (call != null) reject(call, UNAVAILABLE);
    }

    private PluginCall finish(PendingOperation operation) {
        if (!operations.finish(operation)) return null;
        operation.cancellationSignal = null;
        return operation.takeCall();
    }

    private void cancelAndReject(PendingOperation operation, String code) {
        if (!operations.finish(operation)) return;
        dispose(operation, code);
    }

    private static void dispose(PendingOperation operation, String code) {
        PluginCall call = operation.takeCall();
        CancellationSignal signal = operation.cancellationSignal;
        operation.cancellationSignal = null;
        if (signal != null) {
            try {
                signal.cancel();
            } catch (RuntimeException ignored) {
                // The operation gate already prevents all late callbacks from settling this call.
            }
        }
        if (call != null) reject(call, code);
    }

    private static void reject(PluginCall call, String code) {
        String message;
        if (CANCELLED.equals(code)) {
            message = "Logowanie Google zostało anulowane.";
        } else if (INVALID_RESPONSE.equals(code)) {
            message = "Google zwróciło nieprawidłową odpowiedź.";
        } else {
            message = "Logowanie Google jest teraz niedostępne.";
        }
        call.reject(message, code);
    }

    @Override
    protected void handleOnDestroy() {
        PendingOperation pending = operations.destroy();
        if (pending != null) dispose(pending, CANCELLED);
        super.handleOnDestroy();
    }

    private static final class PendingOperation {
        private PluginCall call;
        private CancellationSignal cancellationSignal = new CancellationSignal();
        private final boolean signIn;

        PendingOperation(PluginCall call, boolean signIn) {
            this.call = call;
            this.signIn = signIn;
        }

        PluginCall takeCall() {
            PluginCall pendingCall = call;
            call = null;
            return pendingCall;
        }
    }

    private static final class SignInCallback implements CredentialManagerCallback<GetCredentialResponse, GetCredentialException> {
        private final WeakReference<GoogleSignInPlugin> owner;
        private final PendingOperation operation;

        SignInCallback(GoogleSignInPlugin plugin, PendingOperation operation) {
            owner = new WeakReference<>(plugin);
            this.operation = operation;
        }

        @Override
        public void onResult(GetCredentialResponse result) {
            GoogleSignInPlugin plugin = owner.get();
            if (plugin != null) plugin.signInResult(operation, result);
        }

        @Override
        public void onError(GetCredentialException error) {
            GoogleSignInPlugin plugin = owner.get();
            if (plugin != null) plugin.signInError(operation, error);
        }
    }

    private static final class SignOutCallback implements CredentialManagerCallback<Void, ClearCredentialException> {
        private final WeakReference<GoogleSignInPlugin> owner;
        private final PendingOperation operation;

        SignOutCallback(GoogleSignInPlugin plugin, PendingOperation operation) {
            owner = new WeakReference<>(plugin);
            this.operation = operation;
        }

        @Override
        public void onResult(Void result) {
            GoogleSignInPlugin plugin = owner.get();
            if (plugin != null) plugin.signOutResult(operation);
        }

        @Override
        public void onError(ClearCredentialException error) {
            GoogleSignInPlugin plugin = owner.get();
            if (plugin != null) plugin.signOutError(operation, error);
        }
    }

    // An identity-based gate also prevents an old callback from completing a newer request.
    static final class OperationGate<T> {
        private T active;
        private boolean destroyed;

        synchronized boolean begin(T operation) {
            if (destroyed || active != null || operation == null) return false;
            active = operation;
            return true;
        }

        synchronized boolean finish(T operation) {
            if (destroyed || operation == null || active != operation) return false;
            active = null;
            return true;
        }

        synchronized T current() {
            return active;
        }

        synchronized T cancel() {
            T pending = active;
            active = null;
            return pending;
        }

        synchronized T destroy() {
            destroyed = true;
            return cancel();
        }

        synchronized boolean isDestroyed() {
            return destroyed;
        }
    }
}
