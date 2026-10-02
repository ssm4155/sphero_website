<?php
// Saves a sign-up (email, target role, company count, resume method).
// Data goes to api/data/waitlist.php, a file that prints nothing when opened in a browser
// (its first line is a PHP exit), so it stays private even without extra server rules.
// Resume and job-description text are never sent here.
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function out($code, $arr) { http_response_code($code); echo json_encode($arr); exit; }

if ($_SERVER['REQUEST_METHOD'] !== 'POST') out(405, ['ok' => false, 'error' => 'Method not allowed.']);

$raw = file_get_contents('php://input', false, null, 0, 4096);
$d = json_decode($raw, true);
if (!is_array($d)) out(400, ['ok' => false, 'error' => 'Invalid request.']);

$email = strtolower(trim((string)($d['email'] ?? '')));
$role = trim((string)($d['role'] ?? ''));
$count = (int)($d['companyCount'] ?? 0);
$method = (($d['resumeMethod'] ?? '') === 'paste') ? 'paste' : 'skip';

if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 200) out(422, ['ok' => false, 'error' => 'Enter a valid email address.']);
if ($role === '' || strlen($role) > 80) out(422, ['ok' => false, 'error' => 'Choose a target role.']);
if ($count < 0 || $count > 20) $count = 0;

$dir = __DIR__ . '/data';
if (!is_dir($dir)) @mkdir($dir, 0755, true);
$file = $dir . '/waitlist.php';
$guard = "<?php http_response_code(404); exit; ?>\n";

// per-IP throttle: max 10 submissions per hour (stored in a guarded .php file too)
$rate = $dir . '/rate-' . md5($_SERVER['REMOTE_ADDR'] ?? 'x') . '.php';
$now = time();
$hits = [];
if (is_file($rate)) {
  foreach (explode("\n", (string)file_get_contents($rate)) as $line) {
    if (ctype_digit($line) && (int)$line > $now - 3600) $hits[] = (int)$line;
  }
}
if (count($hits) >= 10) out(429, ['ok' => false, 'error' => 'Too many attempts. Please try again later.']);
$hits[] = $now;
file_put_contents($rate, $guard . implode("\n", $hits), LOCK_EX);

$exists = false;
if (is_file($file)) {
  $fh = fopen($file, 'r');
  while ($fh && ($row = fgetcsv($fh)) !== false) {
    if (isset($row[1]) && $row[1] === $email) { $exists = true; break; }
  }
  if ($fh) fclose($fh);
}
if (!$exists) {
  $new = !is_file($file);
  $fh = fopen($file, 'a');
  if (!$fh) out(500, ['ok' => false, 'error' => 'We could not save this right now. Please try again shortly.']);
  flock($fh, LOCK_EX);
  if ($new) { fwrite($fh, $guard); fputcsv($fh, ['saved_at', 'email', 'role', 'company_count', 'resume_method']); }
  fputcsv($fh, [gmdate('c'), $email, $role, $count, $method]);
  flock($fh, LOCK_UN);
  fclose($fh);
}
out(200, ['ok' => true]);
