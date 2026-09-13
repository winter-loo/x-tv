package cn.deeloo.tvxbrowser;

import org.junit.Test;
import static org.junit.Assert.*;

public class LoginAssistServerTest {
    private static final String HOST="192.168.10.100:43210";
    private static final String ORIGIN="http://"+HOST;

    @Test public void qrScannerMayOpenOnlyTheReadOnlyLandingPageCrossSite() {
        assertTrue(LoginAssistServer.acceptsSource(HOST,HOST,ORIGIN,null,false,"cross-site","GET","/"));
        assertFalse(LoginAssistServer.acceptsSource(HOST,HOST,ORIGIN,null,false,"cross-site","POST","/pair"));
        assertFalse(LoginAssistServer.acceptsSource(HOST,HOST,ORIGIN,null,false,"cross-site","GET","/frame"));
    }

    @Test public void hostOriginAndFramingChecksRemainStrict() {
        assertFalse(LoginAssistServer.acceptsSource(HOST,"evil.example",ORIGIN,null,false,"none","GET","/"));
        assertFalse(LoginAssistServer.acceptsSource(HOST,HOST,ORIGIN,"http://evil.example",false,"same-origin","POST","/pair"));
        assertFalse(LoginAssistServer.acceptsSource(HOST,HOST,ORIGIN,null,true,"none","GET","/"));
        assertTrue(LoginAssistServer.acceptsSource(HOST,HOST,ORIGIN,ORIGIN,false,"same-origin","POST","/input"));
    }
}
