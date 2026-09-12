#!/usr/bin/env python3
"""Build and verify a signed distribution APK. Never uploads or creates signing keys."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SIGNING = ('TVX_KEYSTORE_PATH', 'TVX_KEYSTORE_PASSWORD', 'TVX_KEY_ALIAS', 'TVX_KEY_PASSWORD')


def run(*args):
    return subprocess.check_output(args, cwd=ROOT, text=True, stderr=subprocess.STDOUT)


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--offline', action='store_true', help='Use cached Gradle dependencies only')
    args = parser.parse_args()
    # An explicit environment configuration takes precedence as a complete set.
    # Never generate a replacement key when local configuration is missing.
    if not any(os.environ.get(key) for key in SIGNING):
        config = Path.home() / '.config/tvx/signing/signing.json'
        if config.exists():
            if config.stat().st_mode & 0o077:
                raise ValueError('Signing configuration must be private (chmod 600)')
            values = json.loads(config.read_text())
            for key in SIGNING:
                if isinstance(values.get(key), str):
                    os.environ[key] = values[key]
    missing = [key for key in SIGNING if not os.environ.get(key)]
    if missing:
        raise ValueError('Missing signing environment variables: ' + ', '.join(missing))
    if not Path(os.environ['TVX_KEYSTORE_PATH']).is_absolute():
        raise ValueError('TVX_KEYSTORE_PATH must be an absolute path')
    if not Path(os.environ['TVX_KEYSTORE_PATH']).is_file():
        raise ValueError('The configured keystore does not exist')

    sdk = os.environ.get('ANDROID_HOME') or os.environ.get('ANDROID_SDK_ROOT')
    if not sdk:
        local = ROOT / 'local.properties'
        if local.exists():
            sdk = next((line.split('=', 1)[1].strip() for line in local.read_text().splitlines()
                        if line.startswith('sdk.dir=')), None)
    if not sdk:
        raise ValueError('Set ANDROID_HOME or sdk.dir in local.properties')
    build_tools = Path(sdk) / 'build-tools' / '36.0.0'
    for tool in ('aapt', 'apksigner'):
        if not (build_tools / tool).is_file():
            raise ValueError('Install Android SDK Build Tools 36.0.0')

    command = ['./gradlew', 'testDebugUnitTest', 'lintRelease', 'assembleRelease', '--max-workers=2', '--console=plain']
    if args.offline:
        command.append('--offline')
    subprocess.run(command, cwd=ROOT, check=True)
    apk = ROOT / 'app/build/outputs/apk/release/app-release.apk'
    if not apk.is_file():
        raise ValueError('No signed release APK was produced')
    signer = run(str(build_tools / 'apksigner'), 'verify', '--verbose', '--print-certs', str(apk))
    if 'CN=Android Debug' in signer:
        raise ValueError('Refusing to package an Android debug-signed APK')
    certificate = re.search(r'Signer #1 certificate SHA-256 digest: (\S+)', signer)
    if not certificate:
        raise ValueError('Cannot verify the signing certificate fingerprint')
    expected = (ROOT / 'signing-certificate.sha256').read_text().strip().lower()
    if not re.fullmatch(r'[0-9a-f]{64}', expected) or certificate[1].lower() != expected:
        raise ValueError('APK signer differs from the pinned long-term certificate')
    badging = run(str(build_tools / 'aapt'), 'dump', 'badging', str(apk))
    if 'application-debuggable' in badging:
        raise ValueError('Refusing to package a debuggable APK')
    package = re.search(r"package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'", badging)
    if not package or package[1] != 'cn.deeloo.tvxbrowser':
        raise ValueError('Unexpected application identity')
    version = dict(line.split('=', 1) for line in (ROOT / 'version.properties').read_text().splitlines()
                   if line and not line.startswith('#'))
    if package[2] != version['versionCode'] or package[3] != version['versionName']:
        raise ValueError('APK version does not match version.properties')
    if not re.fullmatch(r'[0-9A-Za-z][0-9A-Za-z.+-]*', package[3]):
        raise ValueError('Invalid release version name')
    with zipfile.ZipFile(apk) as archive:
        names = archive.namelist()
        if any(name in names for name in ('assets/mock_timeline.html', 'assets/probe.html')):
            raise ValueError('Debug pages leaked into the release APK')
        abis = sorted({name.split('/')[1] for name in names if name.startswith('lib/')})
        if abis != ['armeabi-v7a']:
            raise ValueError('Unexpected APK ABIs: ' + repr(abis))
    digest = sha256(apk)
    destination = ROOT / 'dist' / package[3]
    destination.mkdir(parents=True, exist_ok=True)
    filename = f'X-TV-{package[3]}-armeabi-v7a.apk'
    output = destination / filename
    if output.exists() and sha256(output) != digest:
        raise ValueError('A different artifact already exists for this version; archive it or advance the version')
    shutil.copy2(apk, output)
    shutil.copy2(ROOT / 'docs/install.md', destination / 'INSTALL.md')
    (destination / 'SHA256SUMS').write_text(f'{digest}  {filename}\n')
    metadata = {
        'package': package[1], 'versionCode': int(package[2]), 'versionName': package[3],
        'abis': abis, 'sha256': digest, 'signingCertificateSha256': certificate[1],
        'commit': run('git', 'rev-parse', 'HEAD').strip(),
        'dirty': bool(run('git', 'status', '--porcelain').strip()),
        'validation': ['testDebugUnitTest', 'lintRelease', 'apksigner', 'manifest and debug asset checks'],
    }
    (destination / 'build-info.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n')
    print(f'Verified APK: {output}\nSHA-256: {digest}\nNothing was uploaded.')


if __name__ == '__main__':
    try:
        main()
    except subprocess.CalledProcessError:
        # Do not echo subprocess commands/output that might contain signing configuration.
        sys.exit('Release build or APK verification failed; no distribution artifact was accepted.')
    except (ValueError, OSError) as error:
        sys.exit(str(error))
