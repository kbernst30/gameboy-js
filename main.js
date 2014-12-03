$(document).ready(function() {

    // Gameboy refreshes screen 60 times a seconds, 60 (frames per second) fps
    // Gameboy emulates 4194304 clock cycles a seconds
    // Each frame executes 69905 (4194304/60) clock cycles a frame
    // So 69905 should be max number of clock cycles executed a frame

    // Create Emulator
    var gameboy = new Gameboy();

    var CLOCK_SPEED = 4194304;

    // to load changes in so draw to screen happens all at once
    var canvasBuffer = document.createElement('canvas');
    var contextBuffer = canvasBuffer.getContext('2d');
    canvasBuffer.width = 160;
    canvasBuffer.height = 144;

    var rgbToHexColour = function(red, green, blue) {
        var decColor = 0x1000000 + blue + 0x100 * green + 0x10000 * red;
        return '#' + decColor.toString(16).substr(1);
    }

    // This function should execute 60 times a second (60 fps)
    var emulationLoop = function() {

        var MAXCYCLES = 69905;
        var cyclesExecuted = 0;

        var c = document.getElementById("game-screen");
        var ctx = c.getContext("2d");

        while(cyclesExecuted < MAXCYCLES) {

            if (gameboy.cpuStopped) break;

            // FETCH DECODE EXECUTE
            var cycles = gameboy.executeOpcode();
            cyclesExecuted += cycles;

            gameboy.updateTimers(cycles);
            gameboy.updateGraphics(cycles);
            gameboy.doInterrupts();
        }

        if (!gameboy.cpuStopped) {
            var screenData = gameboy.screenData;
            for (var i = 0; i < gameboy.screenData.length; i++) {
                for (var j = 0; j < gameboy.screenData[i].length; j++) {
                    var col = rgbToHexColour(gameboy.screenData[i][j][0],
                        gameboy.screenData[i][j][1], gameboy.screenData[i][j][2]);
                    contextBuffer.fillStyle = col;
                    contextBuffer.fillRect(i, j, 1, 1);
                }
            }

            ctx.drawImage(canvasBuffer, 0, 0);
        } else {
            console.log("STOPPED");
        }

        setTimeout(emulationLoop, 17);
    }

    // Wish i could use jQuery here but they don't let me transfer ArrayBuffer :(
    var xhr = new XMLHttpRequest();
    xhr.addEventListener('load', function() {
        if (xhr.status == 200) {
            var data = new Uint8Array(xhr.response);
            gameboy.initialize();

            //   load data into memory
            for (var i = 0; i < data.length; i++) {
                if (i < 10) console.log(data[i].toString(16));
            }
            gameboy.loadProgram(data);

            // Initialize Display on Browser Window
            var c = document.getElementById("game-screen");
            var ctx = c.getContext("2d");
            ctx.fillStyle = "#FFFFFF"; // Every pixel white
            ctx.fillRect(0,0,160,144); // Fill every pixel

            // Run emulation loop at 60hz
            setTimeout(emulationLoop, 17);

            document.onkeyup = document.onkeydown = function(evt) {
                // Capture key events in here and we will call the
                // emulators keyPressed or keyReleased function
                var charCode = evt.which;
                var value = evt.type == 'keydown' ? 1 : 0;

                // We will represent keys pressed as 8 bits
                // Map this way (Keyboard = Gameboy = Bit)
                // Right = Right = 0
                // Left = Left = 1
                // Up = Up = 2
                // Down = Down = 3
                // Z = A = 4
                // X = B = 5
                // Right Shift = SELECT = 6
                // Enter = START = 7

                var keyBit = -1;

                switch(charCode) {
                    case 90:
                        // "Z"
                        keyBit = 4;
                        break;
                    case 88:
                        // "X"
                        keyBit = 5;
                        break;
                    case 13:
                        // 'ENTER'
                        keyBit = 7;
                        break;
                    case 38:
                        // UP
                        keyBit = 2;
                        break;
                    case 40:
                        // DOWN
                        keyBit = 3;
                        break;
                    case 37:
                        // LEFT
                        keyBit = 1;
                        break;
                    case 39:
                        // RIGHT
                        keyBit = 0;
                        break;
                    case 16:
                        // SHIFT
                        keyBit = 6;
                        break;
                }

                if (keyBit >= 0 && keyBit <= 8) {
                    if (value) {
                        gameboy.keyPressed(keyBit);
                    } else {
                        gameboy.keyReleased(keyBit);
                    }
                }
            };
        }
    });

    xhr.open('GET', 'Tetris.gb');
    xhr.responseType = 'arraybuffer';
    xhr.send();

});
