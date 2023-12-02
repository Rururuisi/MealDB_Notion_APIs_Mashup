const EventEmitter = require("events");
const readline = require("readline");

const rl = readline.createInterface({
    input: process.stdin,
});

class CloseEmitter extends EventEmitter{
    constructor(){
        super();
        if(process.platform === "win32"){
        rl.on("SIGINT", function(){
            process.emit("SIGINT");
        });
        
        rl.on("SIGHUP", function(){
            process.emit("SIGHUP");
        });
        }
        
        process.on("SIGINT", ()=>{
        this.emit("close");
        });
        process.on("SIGHUP", ()=>{
        this.emit("close");
        });
    }
}

module.exports = CloseEmitter;