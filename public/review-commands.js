// Only complete, explicit commands bypass the model. Questions still go to AI.
export function reviewNavigationCommand(text){
 const command=String(text).trim().toLowerCase().replace(/[.!?]+$/,'').trim();
 const match=command.match(/^(?:please\s+)?(?:(?:go|move|take me)\s+(?:to\s+)?)?(?:the\s+)?(next|previous|back)(?:\s+(?:step|change))?(?:\s+please)?$/);
 return match?(match[1]==='next'?'next':'previous'):null;
}
