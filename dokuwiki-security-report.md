# DokuWiki Security Analysis Report

**Repository:** https://github.com/dokuwiki/dokuwiki  
**Analysis Date:** 2026-04-01  
**Scope:** Source code analysis of the current master branch  
**Exclusions:** Issues requiring superuser/admin login are excluded  

---

## Executive Summary

This report documents security vulnerabilities identified through static analysis of the DokuWiki codebase. The analysis focused on issues exploitable by anonymous users, regular authenticated users, or editors. A total of **12 issues** were identified ranging from High to Low severity.

---

## HIGH Severity

### 1. PHP Object Injection via `unserialize()` on Draft Files (CWE-502)

**Files:**
- `inc/Draft.php:122`
- `inc/parserutils.php:459`
- `inc/Cache/CacheInstructions.php:28`
- `lib/plugins/extension/Repository.php:307`

**Description:**  
Multiple locations in DokuWiki call `unserialize()` on data read from local files without using the `allowed_classes` parameter to restrict deserialization to safe types.

```php
// inc/Draft.php:122
$draft = unserialize(io_readFile($this->cname, false));

// inc/parserutils.php:459
$meta = file_exists($file) ?
    unserialize(io_readFile($file, false)) :
    ['current' => [], 'persistent' => []];

// inc/Cache/CacheInstructions.php:28
return empty($contents) ? [] : unserialize($contents);
```

**Attack Vector:**  
An authenticated editor can create a draft via the normal editing interface. The draft is serialized and stored via `io_saveFile($draft['cname'], serialize($draft))` (Draft.php:94). The draft filename is derived from `getCacheName("$client\n$ID", '.draft')`. If an attacker can write a crafted serialized payload to the cache/draft file location (e.g., through a file upload vulnerability, race condition, or symlink attack on the flat-file storage), the `unserialize()` call could instantiate arbitrary PHP objects, leading to Remote Code Execution through POP gadget chains present in DokuWiki's dependencies (phpseclib, SimplePie, etc.).

**Impact:** Potential Remote Code Execution  
**Recommendation:** Use `unserialize($data, ['allowed_classes' => false])` or switch to `json_encode`/`json_decode` for serialization.

---

### 2. CSRF Vulnerability in AJAX `callLock()` Function (CWE-352)

**File:** `inc/Ajax.php:129-163`

**Description:**  
The `callLock()` AJAX handler performs state-changing operations (page locking and draft saving) without verifying the CSRF security token. Compare this to `callDraftdel()` at line 180 which properly calls `checkSecurityToken()`.

```php
protected function callLock()
{
    // NO checkSecurityToken() call here!
    $ID = cleanID($INPUT->post->str('id'));
    if (empty($ID)) return;
    $INFO = pageinfo();
    // ...
    lock($ID);                    // State-changing: writes lock file
    $draft = new Draft($ID, $INFO['client']);
    $draft->saveDraft();          // State-changing: writes draft file with POST data
}
```

**Attack Vector:**  
An attacker creates a malicious webpage that submits a POST request to the victim's DokuWiki instance's AJAX endpoint (`lib/exe/ajax.php?call=lock`). When an authenticated editor visits the page, their browser sends the request with their session cookie, causing:
1. Arbitrary pages to be locked under the victim's identity
2. Arbitrary draft content to be saved for the victim, potentially overwriting their actual drafts

**Impact:** Page manipulation, draft poisoning, denial of editing  
**Recommendation:** Add `if (!checkSecurityToken()) return;` at the beginning of `callLock()`.

---

### 3. LDAP Filter Injection via Incomplete Escaping (CWE-90)

**File:** `lib/plugins/authldap/auth.php:527-535`

**Description:**  
The `filterEscape()` method used to sanitize user input for LDAP queries has an incomplete character set:

```php
protected function filterEscape($string)
{
    return preg_replace_callback(
        '/([\x00-\x1F\*\(\)\\\\])/',
        static fn($matches) => "\\" . implode("", unpack("H2", $matches[1])),
        $string
    );
}
```

Per RFC 4515, the characters that MUST be escaped in LDAP search filters are: `*`, `(`, `)`, `\`, and NUL (`\00`). While these are covered, the implementation does not escape the equals sign `=` or other characters that could modify filter semantics in certain LDAP configurations. More critically, the regex escapes `\x00-\x1F` (control characters) but the full RFC 4515 spec also requires escaping bytes `\x80-\xFF` (high bytes) when they don't form valid UTF-8 sequences.

**Attack Vector:**  
When LDAP authentication is enabled, a crafted username containing characters like `|`, `!`, `~`, or malformed UTF-8 sequences could modify the LDAP filter logic, potentially bypassing authentication filters or extracting information about other users.

**Impact:** Authentication bypass or information disclosure when LDAP auth is in use  
**Recommendation:** Use PHP's `ldap_escape()` function (available since PHP 5.6) with `LDAP_ESCAPE_FILTER` flag instead of a custom implementation.

---

## MEDIUM Severity

### 4. Information Disclosure via Debug Mode Without Authentication (CWE-200)

**Files:**  
- `doku.php:104-107`
- `inc/html.php:716-808`

**Description:**  
When `$conf['allowdebug']` is enabled, the debug action (`?do=debug`) is accessible to **any user** (including anonymous) without any authentication or authorization check:

```php
// doku.php:104-107
if ($conf['allowdebug'] && $ACT == 'debug') {
    html_debug();
    exit;
}
```

The `html_debug()` function exposes:
- Full `$_SERVER` array (document root, script paths, server software)
- Complete DokuWiki configuration (with `debug_guard` sanitization)
- `$_SESSION` data
- `$_ENV` environment variables
- All PHP ini settings via `ini_get_all()`
- Apache version and modules
- PHP version
- Auth backend capabilities

**Attack Vector:** Any anonymous user visits `?do=debug` on a DokuWiki instance with debug mode enabled.

**Impact:** Disclosure of server configuration, internal paths, PHP settings, and potentially sensitive environment variables.  
**Recommendation:** Add an authentication/authorization check (e.g., require admin privileges) before displaying debug information.

---

### 5. HTTP Debug Mode Enablement via Request Parameter (CWE-200)

**File:** `inc/HTTP/DokuHTTPClient.php:36-46`

**Description:**  
When `$conf['allowdebug']` is set, any user can enable HTTP client debugging by appending `?httpdebug` to any request, or by sending a crafted `Referer` header containing the string "httpdebug":

```php
if ($conf['allowdebug']) {
    if (
        isset($_REQUEST['httpdebug']) ||
        (
            isset($_SERVER['HTTP_REFERER']) &&
            str_contains($_SERVER['HTTP_REFERER'], 'httpdebug')
        )
    ) {
        $this->debug = true;
    }
}
```

**Attack Vector:** An anonymous user triggers HTTP debug mode which could log sensitive HTTP request/response data including authentication headers to proxy services.

**Impact:** Potential disclosure of HTTP traffic details  
**Recommendation:** Restrict debug mode activation to authenticated admin users.

---

### 6. SSRF - No URL Scheme or Private IP Restriction in HTTPClient (CWE-918)

**File:** `inc/HTTP/HTTPClient.php:158-199`

**Description:**  
The `HTTPClient::sendRequest()` method accepts any URL without validating the scheme or target address:

```php
public function sendRequest($url, $data = '', $method = 'GET')
{
    $uri = parse_url($url);
    $server = $uri['host'];
    $port = $uriPort ?: ($uri['scheme'] == 'https' ? 443 : 80);
    $use_tls = ($uri['scheme'] == 'https');
    // No scheme allowlist, no private IP check
}
```

There is no:
- URL scheme allowlist (e.g., only `http://` and `https://`)
- Private/internal IP address filtering (127.0.0.1, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
- DNS rebinding protection

**Attack Vector:**  
Features that fetch external URLs (e.g., external media fetching via `fetch.php`, RSS feed subscriptions, extension repository queries) could be abused to probe internal network services if user-controlled URLs are accepted.

**Impact:** Internal network reconnaissance, access to internal services  
**Recommendation:** Implement URL scheme allowlisting and private IP range blocking.

---

### 7. Weak XSS Content Check for Uploaded Files (CWE-79)

**File:** `inc/media.php:648-679`

**Description:**  
The `media_contentcheck()` function only checks the first 256 bytes of uploaded files for XSS payloads and uses a limited set of HTML tags:

```php
if ($conf['iexssprotect']) {
    $fh = @fopen($file, 'rb');
    if ($fh) {
        $bytes = fread($fh, 256);
        fclose($fh);
        if (preg_match('/<(script|a|img|html|body|iframe)[\s>]/i', $bytes)) {
            return -3;
        }
    }
}
```

**Issues:**
- Only scans the first 256 bytes - malicious content beyond this offset bypasses the check
- Missing dangerous tags: `<svg`, `<math`, `<object`, `<embed`, `<video`, `<audio`, `<link`, `<style`, `<base`, `<form`, `<meta`, `<details/ontoggle`
- Missing event handlers: `onerror`, `onload`, `onfocus`, etc. in attributes
- Missing `javascript:` URI scheme detection
- SVG files are particularly dangerous as they can contain `<script>` within an XML namespace and would bypass the simple regex

**Attack Vector:**  
An authenticated user with upload permissions uploads an SVG file containing `<svg onload="alert(1)">` or a file with XSS payload after the 256-byte offset. When served to other users, the malicious content executes in their browser context. Note that DokuWiki does set a Content-Security-Policy for served media, which provides defense-in-depth.

**Impact:** Stored XSS via uploaded media files  
**Recommendation:** Extend the tag list, increase the scan size, and consider scanning the entire file for small uploads. Use a proper HTML sanitizer for SVG files.

---

### 8. CSRF Token Bypass for Anonymous Users (CWE-352)

**File:** `inc/common.php:110-141`

**Description:**  
The CSRF protection system is completely disabled for anonymous (unauthenticated) users:

```php
function getSecurityToken()
{
    $user = $INPUT->server->str('REMOTE_USER');
    $session = session_id();
    if (trim($user) == '' || trim($session) == '') return '';  // Empty for anonymous
    return PassHash::hmac('md5', $session . $user, auth_cookiesalt());
}

function checkSecurityToken($token = null)
{
    if (!$INPUT->server->str('REMOTE_USER')) return true;  // Always passes for anonymous
    // ...
}
```

**Attack Vector:**  
On DokuWiki instances configured to allow anonymous edits (policy 0 - "Open Wiki"), any state-changing action performed by anonymous users has no CSRF protection. An attacker can craft a page that submits edit forms to the wiki on behalf of visiting anonymous users.

**Impact:** Unauthorized page modifications on open wikis  
**Recommendation:** Generate session-based CSRF tokens for anonymous users as well, or implement SameSite cookie strict mode for all session cookies.

---

### 9. Potential Command Injection via ImageMagick Convert (CWE-78)

**File:** `inc/media.php:1984-1991, 2021-2029`

**Description:**  
The deprecated `media_resize_imageIM()` and `media_crop_imageIM()` functions pass file paths directly to `exec()` without proper shell escaping:

```php
$cmd  = $conf['im_convert'];
$cmd .= ' -resize ' . $to_w . 'x' . $to_h . '!';
$cmd .= " $from $to";     // $from and $to are not escapeshellarg()'d
@exec($cmd, $out, $retval);
```

While `$from` and `$to` are typically internal paths derived from `mediaFN()`, and `$to_w`/`$to_h` are integers, the file paths are not passed through `escapeshellarg()`. If the ImageMagick path or the media file path contains shell metacharacters (e.g., through symlink manipulation or unusual file naming), command injection becomes possible.

**Impact:** Potential command execution  
**Recommendation:** Use `escapeshellarg()` for all arguments passed to shell commands. The modern `splitbrain\Slika` replacement should be preferred.

---

## LOW Severity

### 10. CSRF Token Uses MD5 HMAC (CWE-328)

**File:** `inc/common.php:120`

**Description:**  
The CSRF security token is generated using MD5-based HMAC:

```php
return PassHash::hmac('md5', $session . $user, auth_cookiesalt());
```

While MD5-HMAC is not cryptographically broken for this purpose (unlike plain MD5 collision attacks), it produces only 128-bit output and is considered deprecated by modern security standards. The token is also compared using `!=` (loose comparison) rather than `hash_equals()` (timing-safe comparison):

```php
if (getSecurityToken() != $token) {  // Timing-safe comparison not used
```

**Impact:** Theoretical timing side-channel for token prediction  
**Recommendation:** Use `hash_hmac('sha256', ...)` and `hash_equals()` for comparison.

---

### 11. Version Disclosure via Public API Methods (CWE-200)

**Files:**
- `inc/Remote/ApiCore.php:38` (`core.getWikiVersion` - public method)
- `inc/Remote/LegacyApiCore.php:27-81` (`dokuwiki.getVersion` - public method)

**Description:**  
The Remote API exposes exact DokuWiki version information (including Git commit hashes) through public methods that require no authentication:

```php
#[ApiCall(public: true)]
public function getWikiVersion(): string
{
    return getVersion();
}
```

**Attack Vector:** Any anonymous user can query the XML-RPC or JSON-RPC API endpoint to retrieve the exact version.

**Impact:** Aids attackers in identifying applicable exploits for the specific version  
**Recommendation:** Remove or restrict version disclosure methods, or make them non-public.

---

### 12. install.php Accessible After Installation (CWE-749)

**File:** `install.php`

**Description:**  
The installer script remains accessible on the filesystem after installation. While it checks for existing configuration files and refuses to overwrite them, the script's existence:
1. Discloses that DokuWiki is installed (fingerprinting)
2. Could potentially be exploited if configuration files are somehow removed or truncated
3. Leaks the DokuWiki root path in error messages (line 508: `str_replace($_SERVER['DOCUMENT_ROOT'], ...)`)

The installer uses `require_once(DOKU_INC . 'inc/lang/' . $LC . '/lang.php')` with user input `$_REQUEST['l']` filtered through `preg_replace('/[^a-z\-]+/', '', ...)`. While the regex is restrictive, the pattern of including files based on user input is inherently risky.

**Impact:** Information disclosure, potential for re-installation if config files are lost  
**Recommendation:** Delete or rename `install.php` after installation, or add a lockfile check.

---

## Summary Table

| # | Vulnerability | Severity | CWE | Exploitable By |
|---|---|---|---|---|
| 1 | PHP Object Injection via unserialize() | HIGH | CWE-502 | Authenticated user (editor) |
| 2 | CSRF in AJAX callLock() | HIGH | CWE-352 | Any authenticated user (via social engineering) |
| 3 | LDAP Filter Injection | HIGH | CWE-90 | Anonymous (when LDAP auth is configured) |
| 4 | Debug Info Disclosure (no auth check) | MEDIUM | CWE-200 | Anonymous |
| 5 | HTTP Debug via Request Parameter | MEDIUM | CWE-200 | Anonymous |
| 6 | SSRF in HTTPClient | MEDIUM | CWE-918 | Depends on exposed features |
| 7 | Weak XSS Check for Uploads | MEDIUM | CWE-79 | Authenticated user (with upload perms) |
| 8 | CSRF Bypass for Anonymous Users | MEDIUM | CWE-352 | Anonymous (on open wikis) |
| 9 | Command Injection via ImageMagick | MEDIUM | CWE-78 | Authenticated user (indirect) |
| 10 | MD5 HMAC and Timing-Unsafe CSRF Token | LOW | CWE-328 | Theoretical |
| 11 | Version Disclosure via API | LOW | CWE-200 | Anonymous |
| 12 | install.php Accessible Post-Install | LOW | CWE-749 | Anonymous |

---

## Notes

- DokuWiki demonstrates generally good security practices: consistent use of `hsc()` for HTML escaping, ACL checks via `auth_quickaclcheck()`, Content-Security-Policy headers on served media, `HttpOnly` and `SameSite=Lax` cookie flags, and CSRF token verification on most state-changing actions.
- The `send_redirect()` function properly uses `stripctl()` to defend against HTTP Response Splitting.
- Session management includes proper cookie configuration with `secure`, `httponly`, and `samesite` flags.
- The XML-RPC handler strips DOCTYPE declarations to prevent XXE attacks.
- Issues #4 and #5 require `$conf['allowdebug']` to be enabled, which is off by default.
- Issue #3 only applies when LDAP authentication is configured.
- Issue #9 uses deprecated functions; the modern Slika library is the default.
