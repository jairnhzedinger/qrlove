const formatTimestamp = () => new Date().toISOString();

const log = (level, message, metadata = {}) => {
  const payload = {
    timestamp: formatTimestamp(),
    level,
    message,
    ...metadata
  };

  if (level === 'error') {
    console.error(JSON.stringify(payload));
  } else if (level === 'warn') {
    console.warn(JSON.stringify(payload));
  } else {
    console.log(JSON.stringify(payload));
  }
};

const info = (message, metadata) => log('info', message, metadata);
const warn = (message, metadata) => log('warn', message, metadata);
const error = (message, metadata) => log('error', message, metadata);

module.exports = {
  info,
  warn,
  error
};
