package cn.deeloo.tvxbrowser;
import org.junit.Test;
import static org.junit.Assert.*;
public class LoginPairingTest {
    @Test public void onlyPairedClientCanControl() {
        LoginPairing p=new LoginPairing(()->0L);
        assertFalse(p.permits(p.code()));assertNull(p.pair("wrong"));
        String token=p.pair(p.code());assertNotNull(token);assertEquals(64,token.length());
        assertTrue(p.permits(token));assertFalse(p.permits(token+"x"));assertFalse(p.permits(null));
        assertNull(p.pair(p.code()));
    }
    @Test public void repeatedGuessesRevokeInvitation() {
        LoginPairing p=new LoginPairing(()->0L);
        for(int i=0;i<5;i++)assertNull(p.pair("invalid"));
        assertNull(p.pair(p.code()));
    }
    @Test public void deadlineRevokesAlreadyPairedClient() {
        long[] now={0};LoginPairing p=new LoginPairing(()->now[0]);String token=p.pair(p.code());
        now[0]=599999;assertTrue(p.permits(token));now[0]=600000;
        assertFalse(p.permits(token));assertNull(p.pair(p.code()));assertTrue(p.expired());
    }
    @Test public void closingImmediatelyRevokesClient() {
        LoginPairing p=new LoginPairing(()->0L);String token=p.pair(p.code());p.close();
        assertFalse(p.permits(token));assertNull(p.pair(p.code()));
    }
}
