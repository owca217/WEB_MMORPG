package io.github.owca217.webmmorpg;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class GoogleSignInOperationGateTest {
    @Test
    public void rejectsAnOverlappingOperationWithoutReplacingItsOwner() {
        GoogleSignInPlugin.OperationGate<Object> gate = new GoogleSignInPlugin.OperationGate<>();
        Object first = new Object();

        assertTrue(gate.begin(first));
        assertFalse(gate.begin(new Object()));
        assertSame(first, gate.current());
    }

    @Test
    public void onlyTheCurrentOperationCanFinishAndOnlyOnce() {
        GoogleSignInPlugin.OperationGate<Object> gate = new GoogleSignInPlugin.OperationGate<>();
        Object first = new Object();
        assertTrue(gate.begin(first));

        assertFalse(gate.finish(new Object()));
        assertSame(first, gate.current());
        assertTrue(gate.finish(first));
        assertFalse(gate.finish(first));
        assertNull(gate.current());
    }

    @Test
    public void aLateSignInResultCannotFinishTheSignOutThatReplacedIt() {
        GoogleSignInPlugin.OperationGate<Object> gate = new GoogleSignInPlugin.OperationGate<>();
        Object signIn = new Object();
        Object signOut = new Object();
        assertTrue(gate.begin(signIn));

        assertSame(signIn, gate.cancel());
        assertTrue(gate.begin(signOut));
        assertFalse(gate.finish(signIn));
        assertSame(signOut, gate.current());
        assertTrue(gate.finish(signOut));
    }

    @Test
    public void destructionCancelsPendingWorkAndRefusesNewRequests() {
        GoogleSignInPlugin.OperationGate<Object> gate = new GoogleSignInPlugin.OperationGate<>();
        Object signIn = new Object();
        assertTrue(gate.begin(signIn));

        assertSame(signIn, gate.destroy());
        assertTrue(gate.isDestroyed());
        assertNull(gate.current());
        assertFalse(gate.finish(signIn));
        assertFalse(gate.begin(new Object()));
        assertNull(gate.destroy());
    }
}
