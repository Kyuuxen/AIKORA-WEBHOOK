function log(msg, type = "INFO") {
  console.log(`[${new Date().toLocaleTimeString()}] [${type}] ${msg}`);
}
module.exports = { log };
