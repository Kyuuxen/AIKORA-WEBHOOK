function log(message, type = "INFO") {
  const timestamp = new Date().toLocaleTimeString();
  const prefix = {
    INFO:    "[INFO]",
    SUCCESS: "[SUCCESS]",
    ERROR:   "[ERROR]",
    WARN:    "[WARN]",
    SYSTEM:  "[SYSTEM]",
    CMD:     "[CMD]",
  }[type] || "[INFO]";
  console.log(`[${timestamp}] ${prefix} ${message}`);
}

module.exports = { log };
