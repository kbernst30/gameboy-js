function Gameboy() {
	// 1 Machine Cycle = 4 Clock Cycles

	var ths = this;

	// Graphics
	// Use Tiles and Sprites - Tiles are 8x8 pixels
	// The screen can display 160x144 but the real resolution of the screen is
	// 256x256 (32x32 tiles) to allow for scrolling in and out of the screen
	// There is also a window between background (tiles) and sprites. This is
	// a fixed panel that doesn't scroll with the background and can be used to
	// display stuff like health or scores
	this.SCREEN_HEIGHT = 256;
	this.SCREEN_WIDTH = 256;
	this.VISIBLE_WIDTH = 160;
	this.VISIBLE_HEIGHT = 144;

	this.screenData = [];

	// Flag for if STOP occurred - halt CPU and LCD display
	this.cpuStopped = false;

	// Flag for halted CPU
	this.halted = false;

	// Flag Bits in Register F
	this.ZERO_BIT = 7;
	this.SUBTRACT_BIT = 6;
	this.HALF_CARRY_BIT = 5;
	this.CARRY_BIT = 4;

	// Time Stuff
	this.timerCounter = 1024; // initial value, frequency 4096 (4194304/4096)
	this.dividerCounter = 0;
	this.isClockEnabled = true;

	// Timer Memory Address Constants
	this.DIVIDER_REGISTER_ADDR = 0xFF04 // The divider register is located here
	this.TIMER_ADDR = 0xFF05; // The time is located here and counts up at a set interval
	this.TIMER_MODULATOR_ADDR = 0xFF06; // Timer modulator that timer resets to on overflow is here

	// Timer Controller is 3-bit that controls timer and specifies frequency.
	// The 1st 2 bits describe frequency. Here is the mapping:
	// 00: 4096 Hz
	// 01: 262144 Hz
	// 10: 65536 Hz
	// 11: 16384 Hz
	//
	// The third bit specifies if the timer is enabled (1) or disabled (0)
	// This is the memory address that the controller is stored at
	this.TIMER_CONTROLLER_ADDR = 0xFF07;

	// There are 4 types of interrupts that can occur and the following are the bits
	// that are set in the enabled register and request register when they occur
	// Note: the lower the bit, the higher priority of the interrupt
	// Bit 0: V-Blank Interupt
	// Bit 1: LCD Interupt
	// Bit 2: Timer Interupt
	// Bit 4: Joypad Interupt
	//
	// Interrupt Register Address Constants
	this.INTERRUPT_ENABLED_ADDR = 0xFFFF;
	this.INTERRUPT_REQUEST_ADDR = 0xFF0F;

	// Interrupt enabled switch, if this is off, then no interrupts are serviced
	this.interruptsEnabled = true;
	// Used by instruction DI to determine if interrupts will be disabled
	this.toDisableInterrupts = -1;
	// User by instruction EI to determine if interrupts will be enabled
	this.toEnableInterrupts = -1;

	// counter to know when a scanline has finished drawing and it is time to move
	// onto the next scanline. It takes 456 clock cycles to draw a scanline
	this.scanlineCounter = 456;

	// Scanline Constants
	this.CURRENT_SCANLINE_ADDR = 0xFF44;
	this.LCD_STATUS_ADDR = 0xFF41;

	// The LCD Control Register is VERY IMPORTANT. Here is what each bit represents
	// Bit 7 - LCD Display Enable (0=Off, 1=On)
	// Bit 6 - Window Tile Map Display Select (0=9800-9BFF, 1=9C00-9FFF)
	// Bit 5 - Window Display Enable (0=Off, 1=On)
	// Bit 4 - BG & Window Tile Data Select (0=8800-97FF, 1=8000-8FFF)
	// Bit 3 - BG Tile Map Display Select (0=9800-9BFF, 1=9C00-9FFF)
	// Bit 2 - OBJ (Sprite) Size (0=8x8, 1=8x16)
	// Bit 1 - OBJ (Sprite) Display Enable (0=Off, 1=On)
	// Bit 0 - BG Display (for CGB see below) (0=Off, 1=On)
	//
	// THis is The address of the register
	this.LCD_CONTROL_ADDR = 0xFF40;

	// Memory Management Unit
	this.mmu = new MMU();

	this.registers = {
		// 8-bit Registers (Can be 0 - 255)
		A: 0,
		B: 0,
		C: 0,
		D: 0,
		E: 0,
		F: 0,
		H: 0,
		L: 0,

		// 16-bit Registers
		PC: 0, // Program Counter
		SP: 0, // Stack Pointer
	};

	this.initialize = function() {

		ths.halted = false;

		// Set init values of PC and SP to these specified values from GB Docs
		ths.registers.PC = 0x100;
		ths.registers.SP = 0xFFFE;

		// Initial values of registers from Docs - Word Pairs should look like the following:
		// AF=0x01B0;
		// BC=0x0013;
		// DE=0x00D8;
		// HL=0x014D;
		ths.registers.A = 0x01;
		ths.registers.F = 0xB0;
		ths.registers.B = 0x00;
		ths.registers.C = 0x13;
		ths.registers.D = 0x00;
		ths.registers.E = 0xD8;
		ths.registers.H = 0x01;
		ths.registers.L = 0x4D;

		// Initialize Graphics
		for (var i = 0; i < ths.VISIBLE_WIDTH; i++) {
			ths.screenData[i] = new Array();
			for (var j = 0; j < ths.VISIBLE_HEIGHT; j++) {
				ths.screenData[i][j] = new Array(3);
				ths.screenData[i][j][0] = 0;
				ths.screenData[i][j][1] = 0;
				ths.screenData[i][j][2] = 0;
			}
		}

		// Initialize memory
		ths.mmu.initialize();
	};

	this.loadProgram = function(data) {
		ths.mmu.setCartridgeData(data);
	};

	this.debug = 0;
	this.executeOpcode = function() {
		var cycles = 0;

		if (!ths.halted) {
			// Fetch the next operation that the program counter points too.
			var nextOp = ths.mmu.read(ths.registers.PC);
			if (ths.debug < 300) {
				// console.log(nextOp.toString(16) + '\n');
			}
			// Execute the operation
			cycles = ths.executeOperation(nextOp);

			// Increment the program counter
			ths.registers.PC++;
			ths.debug++;
		} else {
			cycles = 4;
		}

		// Enable or disable interrupts
		if (ths.toDisableInterrupts >= 0) {
			ths.toDisableInterrupts += 1;
			if (ths.toDisableInterrupts === 2) {
				ths.interruptsEnabled = false;
				ths.toDisableInterrupts = -1;
			}
		}
		if (ths.toEnableInterrupts >= 0) {
			ths.toEnableInterrupts += 1;
			if (ths.toEnableInterrupts === 2) {
				ths.interruptsEnabled = true;
				ths.toEnableInterrupts = -1;
			}
		}

		return cycles;
	};

	ths.pushToStack = function(data) {
		ths.registers.SP--;
		ths.mmu.write(ths.registers.SP, data);
	}

	ths.popFromStack = function() {
		var data = ths.mmu.read(ths.registers.SP);
		ths.registers.SP++;
		return data;
	}

	this.requestInterrupt = function(bit) {
		// bit = 0: V-Blank Interrupt
		// bit = 1: LCD Interrupt
		// bit = 2: Timer Interrupt
		// bit = 4: Joypad Interrupt

		// Make sure we only flip the one requested bit without messing up the others
		var currentRegisterVal = ths.mmu.read(ths.INTERRUPT_REQUEST_ADDR);
		switch (bit) {
			case 0:
				currentRegisterVal |= 1;
				break;
			case 1:
				currentRegisterVal |= 2;
				break;
			case 2:
				currentRegisterVal |= 4;
				break;
			case 4:
				currentRegisterVal |= 16;
				break;
		}

		ths.mmu.write(ths.INTERRUPT_REQUEST_ADDR, currentRegisterVal);
	};

	this.doInterrupts = function() {
		// Check to see if interrupts are enabled
		// Check if interrupts are requested in order of priority
		// Check if interrupt that is request is enabled and if so it runs it

		if (ths.interruptsEnabled) {
			var requestedInterrupts = ths.mmu.read(ths.INTERRUPT_REQUEST_ADDR);
			var enabledInterrupts = ths.mmu.read(ths.INTERRUPT_ENABLED_ADDR);
			if (requestedInterrupts > 0) {
				// Only need to check bits if we know any of them are set
				for (var i = 0; i < 5; i++) {
					if (ths.checkInterruptBitSet(i, requestedInterrupts)) {
						if (ths.checkInterruptBitSet(i, enabledInterrupts)) {
							ths.runInterrupt(i);
						}
					}
				}
			}
		}
	};

	this.checkInterruptBitSet = function(bit, val) {
		switch (bit) {
			case 0:
				return 1 & val;
				break;
			case 1:
				return 2 & val;
				break;
			case 2:
				return 4 & val;
				break;
			case 4:
				return 16 & val;
				break;
		}
	};

	this.runInterrupt = function(interrupt) {
		// The requested interrupt bit is performed
		// Interrupt operations are found in the following locations in game memory
		// V-Blank: 0x40
		// LCD: 0x48
		// TIMER: 0x50
		// JOYPAD: 0x60

		// Interrupt happened, un-halt CPU
		ths.halted = false;

		// We need to flip the master interrupt switch off and then turn off the
		// bit in the interrupt request register for the interrupt we are running
		ths.interruptsEnabled = false;
		var requestedValue = ths.mmu.read(ths.INTERRUPT_REQUEST_ADDR);

		// XOR will turn off the bits because we know it is set in the register
		// It will leave the other ones intact as they are XOR-ing with 0
		switch (interrupt) {
			case 0:
				requestedValue ^= 1;
				break;
			case 1:
				requestedValue ^= 2;
				break;
			case 2:
				requestedValue ^= 4;
				break;
			case 4:
				requestedValue ^= 16;
				break;
		}

		ths.mmu.write(ths.INTERRUPT_REQUEST_ADDR, requestedValue);

		// We now need to save the current PC by pushing it on the stack
		// Then set the PC to the address of the requested interrupt
		ths.pushToStack(ths.registers.PC >> 8);
		ths.pushToStack(ths.registers.PC & 0xFF);
		switch (interrupt) {
			case 0:
				ths.registers.PC = 0x40;
				break;
			case 1:
				ths.registers.PC = 0x48;
				break;
			case 2:
				ths.registers.PC = 0x50;
				break;
			case 4:
				ths.registers.PC = 0x60;
				break;
		}

	};

	this.updateTimers = function(cycles) {

		// We should set the clock frequency right here in case it was just changed
		// by the game (something wrote to address 0xFF07)
		ths.setClockFrequency();

		// The Divider Register counts up continuously from 0 to 255
		// Overflow causes it to reset to 0
		// It can't be paused by isClockEnabled and counts up at frequency of 16382 hz
		// which is every 256 clock cycles
		ths.incrementDividerRegister(cycles);

		// The clock can be disabled so make sure it is enabled before updating anything
		if (ths.isClockEnabled()) {
			// Update based on how many cycles passed
			// The timer increments when this hits 0 as that is based on the
			// frequency in which the timer should increment
			ths.timerCounter -= cycles;

			if (ths.timerCounter <= 0) {

				// We need to reset the counter value so timer can increment again at the
				// correct frequenct
				ths.setClockFrequency();

				// Need to account for overflow - if overflow then we can write	the value
				// that is held in the modulator addr and request Timer Interrupt which is
				// bit 2 of the interrupt register in memory
				// Otherwise we can just increment the timer
				var currentTimerValue = ths.mmu.read(ths.TIMER_ADDR);
				if (ths.mmu.read(ths.TIMER_ADDR) == 255) {
					ths.mmu.write(ths.TIMER_ADDR, ths.mmu.read(ths.TIMER_MODULATOR_ADDR));
					ths.requestInterrupt(2);
				} else {
					ths.mmu.write(ths.TIMER_ADDR, currentTimerValue + 1);
				}
			}
		}
	};

	this.incrementDividerRegister = function(cycles) {
		ths.dividerCounter += cycles;
		if (ths.dividerCounter >= 255) {
			ths.dividerCounter = 0;
			var currentDividerValue = ths.mmu.read(ths.DIVIDER_REGISTER_ADDR);
			if (currentDividerValue === 255) {
				ths.mmu.memory[ths.DIVIDER_REGISTER_ADDR] = 0;
			} else {
				ths.mmu.memory[ths.DIVIDER_REGISTER_ADDR] = currentDividerValue + 1;
			}
		}
	};

	this.isClockEnabled = function() {
		var timerController = ths.mmu.read(ths.TIMER_CONTROLLER_ADDR);
		// this is the second bit of the controller, which specifies enabled or disabled
		return timerController & 4;
	};

	this.getClockFrequency = function() {
		// We only care about the first 2 bits to find out the frequency
		return ths.mmu.read(ths.TIMER_CONTROLLER_ADDR) & 3;
	};

	this.setClockFrequency = function() {
		// ths.timerCounter will be equal to clockspeed(4194304)/frequency
		var frequency = ths.getClockFrequency();
		switch (frequency) {
			case 0:
				// frequency 4096
				ths.timerCounter = 1024;
				break;
			case 1:
				// frequency 262144
				ths.timerCounter = 16;
				break;
			case 2:
				// frequency 65536
				ths.timerCounter = 64;
				break;
			case 3:
				// frequency 16382
				ths.timerCounter = 256;
				break;
		}
	};

	this.updateGraphics = function(cycles) {

		// Deal with setting LCD status
		ths.setLcdStatus();

		// If LCD Display is enabled, decerement counter by number of cycles
		// Otherwise do nothing
		if (ths.isLcdDisplayEnabled()) {
			ths.scanlineCounter -= cycles;
		} else {
			return;
		}

		// If scanline counter hit 0, we need to move onto the next scanline
		// Current scanline is found in memory in 0xFF44
		// We can't write to this memory location using write functionas doing so
		// should cause the value here to be set to 0 so access the memory directly
		// Scanline 0 - 143 (144 in total) need to be rendered onto the screen
		// Scanline 144 - 153 is the Vertical Blank Period and we need to
		// request the Vertical Blank Interrupt
		// If Scanline is greater than 153, reset to 0
		if (ths.scanlineCounter <= 0) {
			var scanline = ths.mmu.read(ths.CURRENT_SCANLINE_ADDR);
			scanline++;
			ths.mmu.memory[ths.CURRENT_SCANLINE_ADDR] = scanline;

			// Reset scanline counter
			ths.scanlineCounter = 456;

			if (scanline <= 143) {
				ths.drawToScreen();
			} else if (scanline == 144) {
				// We only need to request this interrupt as we enter Vertical
				// Blank period, not for every value in V-Blank so only check
				// for first V-Blank scanline
				ths.requestInterrupt(0); // 0 is the bit for V-Blank interrupt
			} else if (scanline > 153) {
				scanline = 0;
				ths.mmu.memory[ths.CURRENT_SCANLINE_ADDR] = scanline;
			}
		}
	};

	this.isLcdDisplayEnabled = function() {
		// Bit 7 of LCD Control Register tell us if the LCD is enabled or disabled
		return ths.mmu.read(ths.LCD_CONTROL_ADDR) & parseInt("10000000", 2);
	};

	this.setLcdStatus = function() {
		// LCD status is stored in memory address 0xFF41
		// The first 2 bits represent the mode of the LCD and are as follows:
		// 00 (0): Horizontal-Blank
		// 01 (1): Vertical-Blank
		// 10 (2): Searching Sprites Atts
		// 11 (3): Transfering Data to LCD Driver

		var currentLcdStatus = ths.mmu.read(ths.LCD_STATUS_ADDR);
		var currentScanline = ths.mmu.read(ths.CURRENT_SCANLINE_ADDR);

		// IMPORTANT: If LCD is disabled, then the LCD mode must be set to 1 (V-Blank)
		// When doing this, make sure to reset the scanline counter and current scanline
		if (!ths.isLcdDisplayEnabled()) {
			// Set the status bits to 1 and write
			currentLcdStatus &= parseInt("11111100", 2);
			currentLcdStatus ^= parseInt("00000001", 2);
			ths.mmu.write(ths.LCD_STATUS_ADDR, currentLcdStatus);
			ths.scanlineCounter = 456;
			ths.mmu.memory[ths.CURRENT_SCANLINE_ADDR] = 0;
			return;
		}

		// Each scanline takes 456 clock cycles and this is further split up
		// If within the first 80 cycles of the 456, we should be in mode 2
		// If within the next 172 cycles of the 456, we should be in  mode 3
		// Past this point up to the end of the 456, we should be in mode 0
		// If within V-Blank (scanline 144 - 153) we should be in mode 1

		var mode = currentLcdStatus & 3; // This will give us the value of the first 2 bits
		var newMode = mode;

		// Interrupts are only enabled during mode change if the following bits are
		// enabled in the status register when a mode is enabled
		// Bit 3: Mode 0 Interupt Enabled
		// Bit 4: Mode 1 Interupt Enabled
		// Bit 5: Mode 2 Interupt Enabled
		// Have a boolean to see if an interrupt should be enabled
		var interruptEnabled = 0;

		if (currentScanline >= 144) {
			// Set mode to 1
			currentLcdStatus &= parseInt("11111100", 2);
			currentLcdStatus ^= parseInt("00000001", 2);
			newMode = 1;
			// Interrupt enabled if bit 4 set
			interruptEnabled = currentLcdStatus & parseInt("00010000", 2);
		} else {
			if (ths.scanlineCounter >= (456 - 80) && ths.scanlineCounter <= 456) {
				// Set mode to 2
				currentLcdStatus &= parseInt("11111100", 2);
				currentLcdStatus ^= parseInt("00000010", 2);
				newMode = 2;
				// Interrupt enabled if bit 5 set
				interruptEnabled = currentLcdStatus & parseInt("00100000", 2);
			} else if (ths.scanlineCounter >= (456 - 80 - 172) && ths.scanlineCounter < (456 - 80)) {
				// Set mode to 3
				currentLcdStatus &= parseInt("11111100", 2);
				currentLcdStatus ^= parseInt("00000011", 2);
				newMode = 3;
			} else {
				// Set mode to 0
				currentLcdStatus &= parseInt("11111100", 2);
				currentLcdStatus ^= parseInt("00000000", 2);
				newMode = 0;
				// Interrupt enabled if bit 3 set
				interruptEnabled = currentLcdStatus & parseInt("00001000", 2);
			}
		}

		// If the mode has changed to 0, 1, or 2 and the appropriate interrupt bit
		// was set (interruptEnabled > 0), then we need to request LCD Interrupt
		if (interruptEnabled > 0 && newMode !== 3 && newMode !== mode) {
			ths.requestInterrupt(1);
		}

		// Bit 2 of Status register is Coincedence Flag
		// This should be set to true if current scanline (0xFF44) is equal to
		// value in  register 0xFF45. Otherwise turn it off.
		// If bit 6 is set in the Status register and the coincedence flag is turned
		// on, then request an LCD Interrupt
		if (currentScanline == ths.mmu.read(0xFF45)) {
			currentLcdStatus |= parseInt("00000100", 2);
			if (currentLcdStatus & parseInt("01000000", 2)) {
				ths.requestInterrupt(1);
			}
		} else {
			// currentLcdStatus &= parseInt("11111011", 2);
			currentLcdStatus &= ~(1 << 2);
		}

		ths.mmu.write(ths.LCD_STATUS_ADDR, currentLcdStatus);

	};

	this.drawToScreen = function() {
		// Recall from above, bits of LCD Control Register
		// Bit 7 - LCD Display Enable (0=Off, 1=On)
		// Bit 6 - Window Tile Map Display Select (0=9800-9BFF, 1=9C00-9FFF)
		// Bit 5 - Window Display Enable (0=Off, 1=On)
		// Bit 4 - BG & Window Tile Data Select (0=8800-97FF, 1=8000-8FFF)
		// Bit 3 - BG Tile Map Display Select (0=9800-9BFF, 1=9C00-9FFF)
		// Bit 2 - OBJ (Sprite) Size (0=8x8, 1=8x16)
		// Bit 1 - OBJ (Sprite) Display Enable (0=Off, 1=On)
		// Bit 0 - BG Display (for CGB see below) (0=Off, 1=On)
		var lcdControlValue = ths.mmu.read(ths.LCD_CONTROL_ADDR);

		// If bit 0 is set, then we draw the background tiles
		if (lcdControlValue & parseInt("00000001", 2)) {
			ths.drawTiles(lcdControlValue);
		}
		// If bit 1 is set, then we draw the sprites
		if (lcdControlValue & parseInt("00000010", 2)) {
			ths.drawSprites(lcdControlValue);
		}
	};

	this.drawTiles = function(lcdControlValue) {
		// Important Memory addresses for drawing background and window which
		// are necessary to know because the background (256x256) is bigger than
		// the viewing area (160x144)
		// ScrollY (0xFF42): The Y Position of the BACKGROUND where to start
		//                   drawing the viewing area from
		// ScrollX (0xFF43): The X Position of the BACKGROUND to start drawing
		//                   the viewing area from
		// WindowY (0xFF4A): The Y Position of the VIEWING AREA to start drawing
		//                   the window from
		// WindowX (0xFF4B): The X Positions -7 of the VIEWING AREA to start drawing
		//                   the window from

		var scrollY = ths.mmu.read(0xFF42);
		var scrollX = ths.mmu.read(0xFF43);
		var windowY = ths.mmu.read(0xFF4A);
		var windowX = ths.mmu.read(0xFF4B) - 7;

		// Each tile is 8x8 pixels which is represented by 16 bytes of in memory
		// because each line of the tile is 2 bytes
		var sizeOfTileInBytes = 16;

		// We need Tile Identification numbers that are used to lookup tile data
		// These can be in memory ranges 9800-9BFF or 9C00-9FFF for both the background
		// and the window. Check bit 3 of lcd control register to see what region to use
		// for the background and bit 6 for the window. Value of 0 for the bit
		// means 9800--9BFF and 1 indicates 9C00-9FFF
		var backgroundIdentificationRegion = lcdControlValue & parseInt("00001000", 2);
		var windowIdentificationRegion = lcdControlValue & parseInt("01000000", 2);

		var currentScanline = ths.mmu.read(ths.CURRENT_SCANLINE_ADDR);

		// We only draw the window if it's enabled (bit 5)
		var isWindowEnabled = lcdControlValue & parseInt("00100000", 2);
		var drawWindow = false;
		if (isWindowEnabled) {
			// We need to see if the current scanline we are drawing is even
			// within the Y position of the window. Otherwise we have no window
			// to draw
			if (windowY <= currentScanline) {
				drawWindow = true;
			}
		}

		// Tile data is in one of two regions based on bit 4. We need to figure this out
		// If the region is 8800-97FF then the tile identification number is SIGNED and
		// the value is between -127 and 127
		// If the region is 8000-8FFF then the tile identification number is UNSIGNED and
		// the value is between 0 and 255
		var bitFourValue = lcdControlValue & parseInt("00010000", 2);
		var tileDataRegionStart = null;
		var unsigned = true;
		if (bitFourValue) {
			tileDataRegionStart = 0x8000;
		} else {
			tileDataRegionStart = 0x8800;
			unsigned = false;
		}

		// We need to find out which region the tile identification number is in
		// Remember that which region is dependent on the variables above and if we
		// are drawing the window or not. If we draw the window, we don't have to draw
		// the background behind it
		var tileIdentificationRegionStart = null;
		if (drawWindow) {
			if (windowIdentificationRegion) {
				tileIdentificationRegionStart = 0x9C00;
			} else {
				tileIdentificationRegionStart = 0x9800;
			}
		} else {
			if (backgroundIdentificationRegion) {
				tileIdentificationRegionStart = 0x9C00;
			} else {
				tileIdentificationRegionStart = 0x9800;
			}
		}

		// We need to know what tile we are actually drawing. Use the
		// scrollY or windowY and the current scanline to find this
		var yPosition = null;
		if (drawWindow) {
			yPosition = currentScanline - windowY;
		} else {
			yPosition = scrollY + currentScanline
		}

		// We also need to know where in the tile we are drawing
		var rowOfTile = ((yPosition / 8) * 32) & 0xFFFF;

		// Now we can draw the scanline (160 pixels horizontal)
		for (var px = 0; px < 160; px++) {

			// Determine proper x-position based on window or background
			var xPosition = px + scrollX;
			if (drawWindow) {
				if (px >= windowX) {
					xPosition = px - windowX ;
				}
			}

			// determine which tile we are on (horizontally)
			var tileColumn = xPosition / 8;

			// Now we need to get the tileIdentificationNumber
			var tileIdentificationAddress = tileIdentificationRegionStart + rowOfTile + tileColumn;
			var tileIdentifier = ths.mmu.read(tileIdentificationAddress);
			// If The value has to be signed, offset it by 128
			if (!unsigned) {
				if (tileIdentifier > 127) tileIdentifier = -(128 - (tileIdentifier - 128));
			}

			// Now we have the tile identifier, we can find the region of memory where
			// the tile data itself is
			var tileDataAddress = tileDataRegionStart;
			if (unsigned) {
				tileDataAddress += (tileIdentifier * 16) & 0xFFFF;
			} else {
				tileDataAddress += ((tileIdentifier + 128) * 16) & 0xFFFF;
			}

			// We need to find the correct vertical line we are on of the tile
			var line = yPosition % 8;
			// Every line takes up 2 bytes, not 1 so multiply 2 to get correct line
			line = line * 2;

			// Get the two bytes from memory
			var firstTileByte = ths.mmu.read(tileDataAddress + line);
			var secondTileByte = ths.mmu.read(tileDataAddress + line + 1);

			// An 8-bit line of pixels has colour determined like this example
			// pixel# = 1 2 3 4 5 6 7 8
			// data 2 = 1 0 1 0 1 1 1 0
			// data 1 = 0 0 1 1 0 1 0 1
			// Pixel 1 colour id: 10
			// Pixel 2 colour id: 00
			// Pixel 3 colour id: 11
			// Pixel 4 colour id: 01
			// Pixel 5 colour id: 10
			// Pixel 6 colour id: 11
			// Pixel 7 colour id: 10
			// Pixel 8 colour id: 01

			// Determine what pixel we are currently colouring
			var colourBit = xPosition % 8;
			colourBit -= 7;
			colourBit *= -1;

			// Now we need to combine the tile bytes and determine the colour ID
			// using the colour bit
			var colourId = (secondTileByte >> colourBit) & parseInt("00000001", 2);
			colourId <<= 1;
			colourId |= ((firstTileByte >> colourBit) & parseInt("00000001", 2));

			// Get colour as a string, the colour palette is in memory 0xFF47
			var colour = ths.getColour(colourId, 0xFF47);
			var red = 0;
			var blue = 0;
			var green = 0;

			switch(colour) {
				case "white":
					red = 255; green = 255; blue = 255;
					break;
				case "light_gray":
					red = 0xCC; green = 0xCC; blue = 0xCC;
					break;
				case "dark_gray":
					red = 0x77; green = 0x77; blue = 0x77;
					break;
			}

			var finaly = ths.mmu.read(ths.CURRENT_SCANLINE_ADDR);

			// safety check to make sure what im about
			// to set is int the 160x144 bounds
			if (finaly < 0 || finaly > 143 || px < 0 || px > 159) {
				continue;
			}

			// console.log(red, green, blue);
			ths.screenData[px][finaly][0] = red;
			ths.screenData[px][finaly][1] = green;
			ths.screenData[px][finaly][2] = blue;
		}
	};

	this.drawSprites = function(lcdControlValue) {
		// Sprite data is located at 0x8000-0x8FFF
		// Sprite attributes are located at 0xFE00-0xFE9F and in this region
		// each sprite has 4 bytes of attributes. These are what are in each byte
		// of sprite attributes
		// 0: Sprite Y Position: Position of the sprite on the Y axis of the
		//    viewing display minus 16
		// 1: Sprite X Position: Position of the sprite on the X axis of the
		//    viewing display minus 8
		// 2: Pattern number: This is the sprite identifier used for looking up
		//    the sprite data in memory region 0x8000-0x8FFF
		// 3: Attributes: These are the attributes of the sprite


		// Start by determine the size of the sprite from bit 2 of lcdControl
		var is8x16 = lcdControlValue & parseInt("00000100", 2);

		// There are 40 sprite tiles. Loop through all of them and if they are
		// visible and intercepting with the current scanline, then we can draw
		// them
		for (var sprite = 0; sprite < 40; sprite++) {
			// get Index offset of sprite attributes. Remember there are 4 bytes
			// of attributes per sprite
			var idxOffset = sprite * 4;

			var yPosition = ths.mmu.read(0xFE00 + idxOffset) - 16;
			var xPosition = ths.mmu.read(0xFE00 + idxOffset + 1) - 8;
			var patternNum = ths.mmu.read(0xFE00 + idxOffset + 2);
			var attributes = ths.mmu.read(0xFE00 + idxOffset + 3);

			// The following are what the bits represent in the attributes
			// Bit7: Sprite to Background Priority
			// Bit6: Y flip
			// Bit5: X flip
			// Bit4: Palette number. 0 then it gets it palette from 0xFF48 otherwise 0xFF49
			// Bit3: Not used in standard gameboy
			// Bit2-0: Not used in standard gameboy
			var yFlip = attributes & parseInt("01000000", 2);
			var xFlip = attributes & parseInt("00100000", 2);

			var spriteHeight = is8x16 ? 16 : 8;

			var currentScanline = ths.mmu.read(ths.CURRENT_SCANLINE_ADDR);

			// determine if the sprite intercepts with the scanline
			if ((currentScanline >= yPosition) && (currentScanline < (yPosition + spriteHeight))) {
				var line = currentScanline - yPosition;

				// If we are flipping the sprite vertically (yFlip) read the sprite
				// in backwards
				if (yFlip) {
					line -= spriteHeight;
					line *= -1;
				}

				// Similar process as for tiles
				line *= 2;
				var tileDataAddress = (0x8000 + (patternNum * 16)) + line;
				var firstTileByte = ths.mmu.read(tileDataAddress);
				var secondTileByte = ths.mmu.read(tileDataAddress + 1);

				// its easier to read in from right to left as pixel 0 is
				// bit 7 in the colour data, pixel 1 is bit 6 etc...
				for (var tilePixel = 7; tilePixel >= 0; tilePixel--) {
					var colourBit = tilePixel;
					// If we are flipping the sprite horizontally (xFlip) read the
					// sprite in backwards
					if (xFlip) {
						colourbit -= 7;
						colourbit *= -1;
					}

					var colourId = (secondTileByte >> colourBit) & parseInt("00000001", 2);
					colourId <<= 1;
					colourId |= ((firstTileByte >> colourBit) & parseInt("00000001", 2));

					var paletteAddrBit = attributes & parseInt("00010000", 2);
					var paletteAddr = 0xFF48;
					if (paletteAddrBit) paletteAddr = 0xFF49;

					var colour = getColour(colourId, paletteAddr);

					// White spirtes are transparent so don't draw it
					if (colour == "white") continue;

					var red = 0;
					var green = 0;
					var blue = 0;

					switch(colour) {
						case "white": red = 255; green = 255; blue = 255; break;
						case "light_gray": red = 0xCC; green = 0xCC; blue = 0xCC; break;
						case "dark_gray": red = 0x77; green = 0x77; blue = 0x77; break;
					}

					var xPix = 0 - tilePixel;
					xPix += 7;

					var pixel = xPosition + xPix;

					// sanity check
					if (scanline < 0 || scanline > 143 || pixel < 0 || pixel>159) {
						continue;
					}

					ths.screenData[pixel][currentScanline][0] = red;
					ths.screenData[pixel][currentScanline][1] = green;
					ths.screenData[pixel][currentScanline][2] = blue;

				}
			}
		}
	};

	this.getColour = function(colourNum, paletteAddr) {
		var result = "white";
		var palette = ths.mmu.read(paletteAddr);

		var hi = 0;
		var lo = 0;

		// which bits of the colour palette does the colour id map to?
		switch (colourNum) {
			case 0: hi = 1; lo = 0; break;
			case 1: hi = 3; lo = 2; break;
			case 2: hi = 5; lo = 4; break;
			case 3: hi = 7; lo = 6; break;
		}

		// use the palette to get the colour
		var colour = 0;
		colour = ((palette >> hi) & parseInt("00000001", 2)) << 1;
		colour |= ((palette >> lo) & parseInt("00000001", 2));

		// convert the game colour to emulator colour
		switch (colour) {
			case 0: result = "white"; break;
			case 1: result = "light_gray"; break;
			case 2: result = "dark_gray"; break;
			case 3: result = "black"; break;
		}

		return result;
	};

	this.keyPressed = function(keyBit) {
		// We will represent keys pressed as 8 bits
		// Map this way (Gameboy = Bit)
		// Right = 0
		// Left = 1
		// Up = 2
		// Down = 3
		// A = 4
		// B = 5
		// SELECT = 6
		// START = 7

		// Internal Gameboy memory denotes a key pressed if a bit value is 0
		// Joypad memory is in 0xFF00 and looks like this:
		// Bit 7 - Not used
		// Bit 6 - Not used
		// Bit 5 - P15 Select Button Keys (0=Select)
		// Bit 4 - P14 Select Direction Keys (0=Select)
		// Bit 3 - P13 Input Down or Start (0=Pressed) (Read Only)
		// Bit 2 - P12 Input Up or Select (0=Pressed) (Read Only)
		// Bit 1 - P11 Input Left or Button B (0=Pressed) (Read Only)
		// Bit 0 - P10 Input Right or Button A (0=Pressed) (Read Only)

		// Resume CPU if stopped
		ths.cpuStopped = false;
		ths.debug = 0;

		// Check if the current key requested was not pressed, if it wasn't pressed
		// already, we might need an interrupt
		var alreadyPressed = !((ths.mmu.JOYPAD >> keyBit) & 1);

		// Set joypad state by toggling specific bit off
		ths.mmu.JOYPAD &= ~(1 << keyBit);

		// We only need to request an interrupt if the button requested was one
		// that the game cared about. Basically, if bit 5 is set, the game cares
		// about buttons (a, b, select, start) and if bit 4 is set, the game cares
		// about directional keys
		var joypadMemValue = ths.mmu.read(0xFF00);
		var bitFourSet = joypadMemValue & parseInt("00010000", 2);
		var bitFiveSet = joypadMemValue & parseInt("00100000", 2);

		var shouldRequestInterrupt = false;
		if (bitFourSet && !bitFiveSet && keyBit <= 3) {
			shouldRequestInterrupt = true;
		}
		if (!bitFourSet && bitFiveSet && keyBit > 3) {
			shouldRequestInterrupt = true;
		}

		if (shouldRequestInterrupt && !alreadyPressed) {
			ths.requestInterrupt(4);
		}

	};

	this.keyReleased = function(keyBit) {
		// Flip the bit on (key released) in our Joypad representation
		ths.mmu.JOYPAD |= (1 << keyBit);
	};

	this.setFlagBit = function(bit, isSet) {
		if (isSet) ths.registers.F |= (1 << bit);
		else ths.registers.F &= ~(1 << bit);
	};

	this.inc8Bit = function(register) {
		// Increment register, if overflow past 0xFF roll back to 0
		// set zero bit if zero occurs, half carry bit if carry from lower nibble to upper
		// nibble, and subtract bit to 0
		var curVal = register;
		// We are about to roll into the second nibble (lower nibble is 0xF),
		// half-carry is true
		if ((curVal & 0xF) === 0xF) ths.setFlagBit(ths.HALF_CARRY_BIT, true);
		curVal++;
		if (curVal > 0xFF) {
			curVal = 0;
			ths.setFlagBit(ths.ZERO_BIT, true);
		}
		ths.setFlagBit(ths.SUBTRACT_BIT, false);
		return curVal;
	};

	this.inc16Bit = function(registerHi, registerLo) {
		// Increment register pair, If overflow past 0xFFFF roll back to 0
		var curVal = (registerHi << 8) ^ registerLo;
		curVal++;
		if (curVal > 0xFFFF) curVal = 0;
		registerHi = curVal >> 8;
		registerLo = curVal & 0xFF;
		return {hi: registerHi, lo: registerLo};
	};

	this.dec8Bit = function(register) {
		// Decrement register, if underflow past 0, roll up to 0xFF
		// set zero bit if underflow, half carry bit if carry from lower nibble to upper
		// nibble, and subtract bit to 1
		var curVal = register;
		// We are about to roll into the second nibble (lower nibble is 0xF),
		// half-carry is true
		if ((curVal & 0xF) === 0) ths.setFlagBit(ths.HALF_CARRY_BIT, true);
		curVal--;

		if (curVal === 0) {
			ths.setFlagBit(ths.ZERO_BIT, true);
		}
		if (curVal < 0) {
			curVal = 0xFF;
		}
		ths.setFlagBit(ths.SUBTRACT_BIT, true);
		return curVal;
	};

	this.dec16Bit = function(registerHi, registerLo) {
		// Decrement register pair and if underflow past
		// 0 roll back to 0xFFFF
		var curVal = (registerHi << 8) ^ registerLo;
		curVal--;
		if (curVal < 0) curVal = 0xFFFF;
		registerHi = curVal >> 8;
		registerLo = curVal & 0xFF;
		return {hi: registerHi, lo: registerLo};
	};

	this.add8Bit = function(destination, value, withCarry) {
		// When this is called from an op Code, these are the flags that shuold be set
		// Zero - Set if result is zero.
		// Subtract - Reset.
		// Half-Carry - Set if carry from bit 3.
		// Carry - Set if carry from bit 7
		// Remember destination is one byte so if overflow, remember to roll back to zero

		// Should we add the carry?
		if (withCarry) {
			// Is the carry bit currently set, add it to value being added
			if ((ths.registers.F >> ths.CARRY_BIT) & 1) {
				value++;
			}
		}

		var result = destination + value;

		// Determine half carry
		var isHalfCarry = destination & 0xF;
		isHalfCarry += value & 0xF;
		if (isHalfCarry > 0xF) ths.setFlagBit(ths.HALF_CARRY_BIT, true);

		if (result > 0xFF) {
			ths.setFlagBit(ths.CARRY_BIT, true);
			result -= 0xFF;
		}

		if (result === 0) {
			ths.setFlagBit(ths.ZERO_BIT, true);
		}

		ths.setFlagBit(ths.SUBTRACT_BIT, false);

		return result;

	};

	this.sub8Bit = function(destination, value, withCarry) {
		// When this is called from an op Code, these are the flags that should be set
		// Zero - Set if result is zero.
		// Subtract - set.
		// Half-carry - Set if no borrow from bit 4.
		// Carry - Set if no borrow.
		// Remember destination is one byte so if underflow, remember to roll back to 0xFF

		// Should we subtract the carry?
		if (withCarry) {
			// Is the carry bit currently set, add it to value being subtracted
			if ((ths.registers.F >> ths.CARRY_BIT) & 1) {
				value++;
			}
		}

		var result = destination - value;

		// Determine half carry
		var isHalfCarry = destination & 0xF;
		isHalfCarry -= value & 0xF;
		if (isHalfCarry < 0) ths.setFlagBit(ths.HALF_CARRY_BIT, true);

		if (result < 0) {
			ths.setFlagBit(ths.CARRY_BIT, true);
			result += 0xFF;
		}

		if (result === 0) {
			ths.setFlagBit(ths.ZERO_BIT, true);
		}

		ths.setFlagBit(ths.SUBTRACT_BIT, true);

		return result;

	};

	this.andRegisters = function(registerOne, registerTwo) {
		// Set zero flag if zero, set half carry, reset carry and subtract
		var res = registerOne & registerTwo;
		if (!res) ths.setFlagBit(ths.ZERO_BIT, true);
		ths.setFlagBit(ths.HALF_CARRY_BIT, true);
		ths.setFlagBit(ths.CARRY_BIT, false);
		ths.setFlagBit(ths.SUBTRACT_BIT, false);

		return res;
	};

	this.xorRegisters = function(registerOne, registerTwo) {
		// Set zero flag if zero, reset half carry, carry and subtract
		var res = registerOne ^ registerTwo;
		if (!res) ths.setFlagBit(ths.ZERO_BIT, true);
		ths.setFlagBit(ths.HALF_CARRY_BIT, false);
		ths.setFlagBit(ths.CARRY_BIT, false);
		ths.setFlagBit(ths.SUBTRACT_BIT, false);

		return res;
	};

	this.orRegisters = function(registerOne, registerTwo) {
		// Set zero flag if zero, reset half carry, carry and subtract
		var res = registerOne | registerTwo;
		if (!res) ths.setFlagBit(ths.ZERO_BIT, true);
		ths.setFlagBit(ths.HALF_CARRY_BIT, false);
		ths.setFlagBit(ths.CARRY_BIT, false);
		ths.setFlagBit(ths.SUBTRACT_BIT, false);

		return res;
	};

	// This is gonna be really long :( but it's best to put it here so I have
	// access to memory and registers.
	// Recall Flags
	//
	// this.ZERO_BIT = 7;
	// this.SUBTRACT_BIT = 6;
	// this.HALF_CARRY_BIT = 5;
	// this.CARRY_BIT = 4;
	this.executeOperation = function(opcode) {
		switch(opcode) {
			case 0x0:
				// NOP - 4 cycles - no operation. Just return clock cycles
				return 4;
				break;
			case 0x1:
				// LD BC, d16 - 12 cycles - load next two bytes into registers BC
				ths.registers.B = ths.mmu.read(++ths.registers.PC);
				ths.registers.C = ths.mmu.read(++ths.registers.PC);
				return 12;
			case 0x2:
				// LD (BC), A - 8 cycles - Load the value in A into memory address at BC
				var memoryAddress = (ths.registers.B << 8) ^ ths.registers.C;
				ths.mmu.write(memoryAddress, ths.registers.A);
				return 8;
			case 0x3:
				// INC BC - 8 cycles - Increment register pair BC
				var incremented = ths.inc16Bit(ths.registers.B, ths.registers.C);
				ths.registers.B = incremented.hi;
				ths.registers.C = incremented.lo;
				return 8;
			case 0x4:
				// INC B - 4 cycles - Increment register B
				ths.registers.B = ths.inc8Bit(ths.registers.B);
				return 4;
			case 0x5:
				// DEC B - 4 cycles - Decrement register B
				ths.registers.B = ths.dec8Bit(ths.registers.B);
				return 4;
			case 0x6:
				// LD B, d8 - 8 cycles - Load the next byte in the instruction queue into
				// register B
				ths.registers.B = ths.mmu.read(++ths.registers.PC);
				return 8;
			case 0x7:
				// RLCA - 4 cycles - Rotate bits of accumulator left through carry.
				// Carry flag is set to value of bit 7 of A and bit 0 of A is also
				// equal to this value (old bit 7). All other flags are reset
				var newCarryVal = (ths.registers.A >> 7) & 1;
				ths.setFlagBit(ths.CARRY_BIT, newCarryVal);
				ths.registers.A <<= 1;
				ths.registers.A &= 255;
				ths.registers.A ^= newCarryVal;

				ths.setFlagBit(ths.ZERO_BIT, false);
				ths.setFlagBit(ths.SUBTRACT_BIT, false);
				ths.setFlagBit(ths.HALF_CARRY_BIT, false);
				return 4;
			case 0x8:
				// LD (a16), SP - 20 cycles - Load the Stack Pointer into the memory
				// address formed by the next two bytes in the queue
				var firstAddrByte = ths.mmu.read(++ths.registers.PC);
				var secondAddrByte = ths.mmu.read(++ths.registers.PC);
				var resolvedAddr = (firstAddrByte << 8) ^ secondAddrByte;
				var spHi = ths.registers.SP >> 8;
				var spLo = ths.registers.SP & 0xFF;
				ths.mmu.write(resolvedAddr, spLo);
				ths.mmu.write(resolvedAddr + 1, spHi);
				return 20;
			case 0x9:
				// ADD HL, BC - 8 cycles - Add value in BC to HL
				// Subtract flag is reset and half carry and carry are set
				// accordingly
				var BCVal = (ths.registers.B << 8) ^ ths.registers.C;
				var HLVal = (ths.registers.H << 8) ^ ths.registers.L;
				var newVal = BCVal + HLVal;

				ths.setFlagBit(ths.SUBTRACT_BIT, false);
				var halfCarry = ((HLVal & 0xFF00) & 0xF) + ((BCVal >> 8) & 0xF);
				ths.setFlagBit(ths.HALF_CARRY_BIT, halfCarry);
				ths.setFlagBit(ths.CARRY_BIT, newVal > 0xFFFF);

				if (newVal > 0xFFFF) {
					newVal = newVal - 0xFFFF;
				}

				var byteHi = newVal >> 8;
				var byteLo = newVal & 0xFF;
				ths.registers.H = byteHi;
				ths.registers.L = byteLo;
				return 8;
			case 0xA:
				// LD A, (BC) - 8 cycles - get the data at memory address found in
				// BC and load it into A
				var address = (ths.registers.B << 8) ^ ths.registers.C;
				ths.registers.A = ths.mmu.read(address);
				return 8;
			case 0xB:
				// DEC BC - 8 cycles - Decrement register pair BC
				var decremented = ths.dec16Bit(ths.registers.B, ths.registers.C);
				ths.registers.B = decremented.hi;
				ths.registers.C = decremented.lo;
				return 8;
			case 0xC:
				// INC C - 4 cycles - Increment register C
				ths.registers.C = ths.inc8Bit(ths.registers.C);
				return 4;
			case 0xD:
				// DEC C - 4 cycles - Decrement register C
				ths.registers.C = ths.dec8Bit(ths.registers.C);
				return 4;
			case 0xE:
				// LD C, d8 - 8 cycles - Load the next byte in the queue into
				// register C
				ths.registers.C = ths.mmu.read(++ths.registers.PC);
				return 8;
			case 0xF:
				// RRCA - 4 cycles - Rotate bits of accumulator right through carry.
				// Carry flag is set to value of bit 0 of A and bit 7 of A is also
				// equal to this value as well
				var currentCarryVal = (ths.registers.F >> ths.CARRY_BIT) & 1;
				var newCarryVal = ths.registers.A & parseInt("00000001", 2);
				ths.setFlagBit(ths.CARRY_BIT, newCarryVal);
				ths.registers.A >>= 1;
				ths.registers.A &= 255;
				ths.registers.A |= (newCarryVal << 7);

				ths.setFlagBit(ths.ZERO_BIT, false);
				ths.setFlagBit(ths.SUBTRACT_BIT, false);
				ths.setFlagBit(ths.HALF_CARRY_BIT, false);
				return 4;
			case 0x10:
				// STOP 0 - 4 cycles - STOP execution until there is joypad input
				// There is a second byte of the instruction but it isn't used
				ths.registers.PC++;
				// ths.cpuStopped = true;
				return 4;
			case 0x11:
				// LD DE, d16 - 12 cycles - Load the next two bytes in the queue
				// into register pair DE
				ths.registers.D = ths.mmu.read(++ths.registers.PC);
				ths.registers.E = ths.mmu.read(++ths.registers.PC);
				return 12;
			case 0x12:
				// LD (DE), A - 8 cycles - Load the value in A into memory address at DE
				var memoryAddress = (ths.registers.D << 8) ^ ths.registers.E;
				ths.mmu.write(memoryAddress, ths.registers.A);
				return 8;
			case 0x13:
				// INC DE - 8 cycles - Increment register pair BC
				var incremented = ths.inc16Bit(ths.registers.D, ths.registers.E);
				ths.registers.D = incremented.hi;
				ths.registers.E = incremented.lo;
				return 8;
			case 0x14:
				// INC D - 4 cycles - Increment register D
				ths.registers.D = ths.inc8Bit(ths.registers.D);
				return 4;
			case 0x15:
				// DEC D - 4 cycles - Decrement register D
				ths.registers.D = ths.dec8Bit(ths.registers.D);
				return 4;
			case 0x16:
				// LD D, d8 - 8 cycles - Load next byte in queue into register D
				ths.registers.D = ths.mmu.read(++ths.registers.PC);
				return 8;
			case 0x17:
				// RLA - 4 Cycles - Rotate bits of accumulator left through carry.
				// Carry flag is set to value of bit 7 of A and bit 0 of A is equal
				// to what the carry flag was. All other flags are reset
				var currentCarryVal = (ths.registers.F >> ths.CARRY_BIT) & 1;
				var newCarryVal = (ths.registers.A >> 7) & 1;
				ths.setFlagBit(ths.CARRY_BIT, newCarryVal);
				ths.registers.A <<= 1;
				ths.registers.A &= 255;
				ths.registers.A ^= currentCarryVal;

				ths.setFlagBit(ths.ZERO_BIT, false);
				ths.setFlagBit(ths.SUBTRACT_BIT, false);
				ths.setFlagBit(ths.HALF_CARRY_BIT, false);
				return 4;
			case 0x18:
				// JR r8 - 12 cycles - next byte contains value to add to current
				// program counter and then we execute instructions from the new location
				// r8 is signed value
				var offset = ths.mmu.read(++ths.registers.PC);
				if (offset > 127) offset = -(128 - (offset - 128));
				ths.registers.PC += offset - 1;
				return 12;
			case 0x19:
				// ADD HL, DE - 8 cycles - Add value of DE to HL
				// Subtract flag is reset and half carry and carry are set
				// accordingly
				var DEVal = (ths.registers.D << 8) ^ ths.registers.E;
				var HLVal = (ths.registers.H << 8) ^ ths.registers.L;
				var newVal = DEVal + HLVal;

				ths.setFlagBit(ths.SUBTRACT_BIT, false);
				var halfCarry = ((HLVal & 0xFF00) & 0xF) + ((DEVal >> 8) & 0xF);
				ths.setFlagBit(ths.HALF_CARRY_BIT, halfCarry);
				ths.setFlagBit(ths.CARRY_BIT, newVal > 0xFFFF);

				if (newVal > 0xFFFF) {
					newVal = newVal - 0xFFFF;
				}

				var byteHi = newVal >> 8;
				var byteLo = newVal & 0xFF;
				ths.registers.H = byteHi;
				ths.registers.L = byteLo;
				return 8;
			case 0x1A:
				// LD A, (DE) - 8 cycles - get the data at memory address found in
				// DE and load it into A
				var address = (ths.registers.D << 8) ^ ths.registers.E;
				ths.registers.A = ths.mmu.read(address);
				return 8;
			case 0x1B:
				// DEC DE - 8 cycles - Decrement register pair DE
				var decremented = ths.dec16Bit(ths.registers.D, ths.registers.E);
				ths.registers.D = decremented.hi;
				ths.registers.E = decremented.lo;
				return 8;
			case 0x1C:
				// INC E - 4 cycles - Increment register E
				ths.registers.E = ths.inc8Bit(ths.registers.E);
				return 4;
			case 0x1D:
				// DEC E - 4 cycles - Decrement register E
				ths.registers.E = ths.dec8Bit(ths.registers.E);
				return 4;
			case 0x1E:
				// LD E, d8 - 8 cycles - Load the next byte in the queue into
				// register E
				ths.registers.E = ths.mmu.read(++ths.registers.PC);
				return 8;
			case 0x1F:
				// RRA - 4 cycles - Rotate bits of accumulator right through carry.
				// Carry flag is set to value of bit 0 of A and bit 7 of A is equal
				// to what the carry flag was. All other flags are reset
				var currentCarryVal = (ths.registers.F >> ths.CARRY_BIT) & 1;
				var newCarryVal = ths.registers.A & parseInt("00000001", 2);
				ths.setFlagBit(ths.CARRY_BIT, newCarryVal);
				ths.registers.A >>= 1;
				ths.registers.A &= 255;
				ths.registers.A |= (currentCarryVal << 7);

				ths.setFlagBit(ths.ZERO_BIT, false);
				ths.setFlagBit(ths.SUBTRACT_BIT, false);
				ths.setFlagBit(ths.HALF_CARRY_BIT, false);
				return 4;
			case 0x20:
				// JR NZ, r8 - 8 cycles if no action - if zero flag
				// is set to 0, then add the next byte to the current PC and jump
				// to that instruction
				var zeroBitVal = (ths.registers.F >> ths.ZERO_BIT) & 1;
				if (!zeroBitVal) {
					var offset = ths.mmu.read(++ths.registers.PC);
					if (offset > 127) offset = -(128 - (offset - 128));
					ths.registers.PC += offset - 1;
				}
				return 8;
			case 0x21:
				// LD HL, d16 - 12 cycles - Load the next two bytes in the queue
				// into register pair HL
				ths.registers.H = ths.mmu.read(++ths.registers.PC);
				ths.registers.L = ths.mmu.read(++ths.registers.PC);
				return 12;
			case 0x22:
				// LD (HL+), A - 8 cycles - Load the value in A into the memory
				// address in HL and then increment the value in HL
				var addr = (ths.registers.H << 8) ^ ths.registers.L;
				ths.mmu.write(addr, ths.registers.A);
				var incremented = ths.inc16Bit(ths.registers.H, ths.registers.L);
				ths.registers.H = incremented.hi;
				ths.registers.L = incremented.lo;
				return 8;
			case 0x23:
				// INC HL - 8 cycles - Increment the value in register pair HL
				var incremented = ths.inc16Bit(ths.registers.H, ths.registers.L);
				ths.registers.H = incremented.hi;
				ths.registers.L = incremented.lo;
				return 8;
			case 0x24:
				// INC H - 4 cycles - Increment the value in H
				ths.registers.H = ths.inc8Bit(ths.registers.H);
				return 4;
			case 0x25:
				// DEC H - 4 cycles - Decrement the value in H
				ths.registers.H = ths.dec8Bit(ths.registers.H);
				return 4;
			case 0x26:
				// LD H, d8 - 8 cycles - Load the next byte in the queue into
				// register H
				ths.registers.H = ths.mmu.read(++ths.registers.PC);
				return 8;
			case 0x27:
				// DAA - 4 cycles - adjusts register A so that the correct
				// representation of Binary Coded Decimal (BCD) is obtained.
				// Reset half carry flag, if A is zero, set zero flag, set carry
				// bit accordingly
				// Got some help on this one
				if ((ths.registers.F >> ths.SUBTRACT_BIT) & 1) {
					if ((ths.registers.A & 0x0F) > 0x09 || ths.registers.F & 0x20) {
						ths.registers.A -= 0x06;
						if ((ths.registers.A & 0xF) === 0xF0) {
							ths.registers.F |= 0x10;
						} else {
							ths.registers.F &= ~0x10;
						}

					}
					if ((ths.registers.A & 0xF0) > 0x90 || ths.registers.F & 0x10) {
						ths.registers.A -= 0x60;
					}
				} else {
					if ((ths.registers.A & 0x0F > 9) || ths.registers.F & 0x20) {
						ths.registers.A += 0x06;
						if ((ths.registers.A & 0xF) === 0) {
							ths.registers.F |= 0x10;
						} else {
							ths.registers.F &= ~0x10;
						}
					}
					if ((ths.registers.A & 0xF0) > 0x90 || ths.registers.F & 0x10) {
						ths.registers.A += 0x60;
					}
				}
				if (ths.registers.A === 0) {
					ths.registers.F |= 0x80;
				} else {
					ths.registers.F &= ~0x80;
				}
				return 4;
			case 0x28:
				// JR Z, r8 - 8 cycles - if zero flag
				// is set to 1, then add the next byte to the current PC and jump
				// to that instruction
				var zeroBitVal = (ths.registers.F >> ths.ZERO_BIT) & 1;
				if (zeroBitVal) {
					var offset = ths.mmu.read(++ths.registers.PC);
					if (offset > 127) offset = -(128 - (offset - 128));
					ths.registers.PC += offset - 1;
				}
				return 8;
			case 0x29:
				// ADD HL, HL - 8 cycles - Add value of HL to HL
				// Subtract flag is reset and half carry and carry are set
				// accordingly
				var HLVal = (ths.registers.H << 8) ^ ths.registers.L;
				var newVal = HLVal + HLVal;

				ths.setFlagBit(ths.SUBTRACT_BIT, false);
				var halfCarry = ((HLVal & 0xFF00) & 0xF) + ((HLVal >> 8) & 0xF);
				ths.setFlagBit(ths.HALF_CARRY_BIT, halfCarry);
				ths.setFlagBit(ths.CARRY_BIT, newVal > 0xFFFF);

				if (newVal > 0xFFFF) {
					newVal = newVal - 0xFFFF;
				}

				var byteHi = newVal >> 8;
				var byteLo = newVal & 0xFF;
				ths.registers.H = byteHi;
				ths.registers.L = byteLo;
				return 8;
			case 0x2A:
				// LD A, (HL+) - 8 cycles - Load the value found at memory address
				// located in HL and put it in A and then increment value at HL
				var address = (ths.registers.H << 8) ^ ths.registers.L;
				ths.registers.A = ths.mmu.read(address);
				var incremented = ths.inc16Bit(ths.registers.H, ths.registers.L);
				ths.registers.H = incremented.hi;
				ths.registers.L = incremented.lo;
				return 8;
			case 0x2B:
				// DEC HL - 8 cycles - Decrement register pair HL
				var decremented = ths.dec16Bit(ths.registers.H, ths.registers.L);
				ths.registers.H = decremented.hi;
				ths.registers.L = decremented.lo;
				return 8;
			case 0x2C:
				// INC L - 4 cycles - Increment register L
				ths.registers.L = ths.inc8Bit(ths.registers.L);
				return 4;
			case 0x2D:
				// DEC L - 4 cycles - Decrement register L
				ths.registers.L = ths.dec8Bit(ths.registers.L);
				return 4;
			case 0x2E:
				// LD L, d8 - 8 cycles - Load the next byte in the queue into
				// register L
				ths.registers.L = ths.mmu.read(++ths.registers.PC);
				return 8;
			case 0x2F:
				// CPL - 4 cycles - Flip all bits of A and set half carry flag
				// and subtract flag
				ths.registers.A ^= 0xFF;
				ths.setFlagBit(ths.SUBTRACT_BIT, true);
				ths.setFlagBit(ths.HALF_CARRY_BIT, true);
				return 4;
			case 0x30:
				// JR NC, r8 - 8 cycles - if carry flag
				// is set to 0, then add the next byte to the current PC and jump
				// to that instruction
				var carryBitVal = (ths.registers.F >> ths.CARRY_BIT) & 1;
				if (!carryBitVal) {
					var offset = ths.mmu.read(++ths.registers.PC);
					if (offset > 127) offset = -(128 - (offset - 128));
					ths.registers.PC += offset - 1;
				}
				return 8;
			case 0x31:
				// LD SP, d16 - 12 cycles - Load the next two bytes in the queue
				// into the stack pointer
				var byte1 = ths.mmu.read(++ths.registers.PC);
				var byte2 = ths.mmu.read(++ths.registers.PC);
				ths.registers.SP = (byte1 << 8) ^ byte2;
				return 12;
			case 0x32:
				// LD (HL-), A - 8 cycles - Load the value in A into the memory
				// address in HL and then decrement the value in HL
				var addr = (ths.registers.H << 8) ^ ths.registers.L;
				ths.mmu.write(addr, ths.registers.A);
				var decremented = ths.dec16Bit(ths.registers.H, ths.registers.L);
				ths.registers.H = decremented.hi;
				ths.registers.L = decremented.lo;
				return 8;
			case 0x33:
				// INC SP - 8 cycles - Increment the value in the stack pointer
				var hi = ths.registers.SP >> 8;
				var lo = ths.registers.SP & 0xFF;
				var incremented = ths.inc16Bit(hi, lo);
				ths.registers.SP = (incremented.hi << 8) ^ incremented.lo;
				return 8;
			case 0x34:
				// INC (HL) - 12 cycles - Increment the value stored at memory
				// address found in register pair HL
				var addr = (ths.registers.H << 8) ^ ths.registers.L;
				var value = ths.mmu.read(addr);
				value = ths.inc8Bit(value);
				ths.mmu.write(addr, value);
				return 12;
			case 0x35:
				// DEC (HL) - 12 cycles - Decrement the value stored at memory
				// address found in register pair HL
				var addr = (ths.registers.H << 8) ^ ths.registers.L;
				var value = ths.mmu.read(addr);
				value = ths.dec8Bit(value);
				ths.mmu.write(addr, value);
				return 12;
			case 0x36:
				// LD (HL), d8 - 12 cycles - Load the next byte in the queue into
				// memory address found in register pair HL
				var addr = (ths.registers.H << 8) ^ ths.registers.L;
				ths.mmu.write(addr, ths.mmu.read(++ths.registers.PC));
				return 8;
			case 0x37:
				// SCF - 4 cycles - Set the carry flag to true and reset the subtract
				// flag and half carry flag
				ths.setFlagBit(ths.CARRY_BIT, true);
				ths.setFlagBit(ths.SUBTRACT_BIT, false);
				ths.setFlagBit(ths.HALF_CARRY_BIT, false);
				return 4;
			case 0x38:
				// JR C, r8 - 8 cycles - if carry flag
				// is set to 1, then add the next byte to the current PC and jump
				// to that instruction
				var carryBitVal = (ths.registers.F >> ths.CARRY_BIT) & 1;
				if (carryBitVal) {
					var offset = ths.mmu.read(++ths.registers.PC);
					if (offset > 127) offset = -(128 - (offset - 128));
					ths.registers.PC += offset - 1;
				}
				return 8;
			case 0x39:
				// ADD HL, SP - 8 cycles - Add value of SP to HL
				// Subtract flag is reset and half carry and carry are set
				// accordingly
				var HLVal = (ths.registers.H << 8) ^ ths.registers.L;
				var newVal = HLVal + ths.registers.SP;

				ths.setFlagBit(ths.SUBTRACT_BIT, false);
				var halfCarry = ((HLVal & 0xFF00) & 0xF) + ((ths.registers.SP >> 8) & 0xF);
				ths.setFlagBit(ths.HALF_CARRY_BIT, halfCarry);
				ths.setFlagBit(ths.CARRY_BIT, newVal > 0xFFFF);

				if (newVal > 0xFFFF) {
					newVal = newVal - 0xFFFF;
				}

				var byteHi = newVal >> 8;
				var byteLo = newVal & 0xFF;
				ths.registers.H = byteHi;
				ths.registers.L = byteLo;
				return 8;
			case 0x3A:
				// LD A, (HL-) - 8 cycles - Load the value found at memory address
				// located in HL and put it in A and then decrement value at HL
				var address = (ths.registers.H << 8) ^ ths.registers.L;
				ths.registers.A = ths.mmu.read(address);
				var decremented = ths.dec16Bit(ths.registers.H, ths.registers.L);
				ths.registers.H = decremented.hi;
				ths.registers.L = decremented.lo;
				return 8;
			case 0x3B:
				// DEC SP - 8 cycles - Decrement the value in the stack pointer
				var hi = ths.registers.SP >> 8;
				var lo = ths.registers.SP & 0xFF;
				var decremented = ths.dec16Bit(hi, lo);
				ths.registers.SP = (decremented.hi << 8) ^ decremented.lo;
				return 8;
			case 0x3C:
				// INC A - 4 cycles - Increment register A
				ths.registers.A = ths.inc8Bit(ths.registers.A);
				return 4;
			case 0x3D:
				// DEC A - 4 cycles - Decrement register A
				ths.registers.A = ths.dec8Bit(ths.registers.A);
				return 4;
			case 0x3E:
				// LD A, d8 - 8 cycles - Load the next byte in the queue into
				// register A
				ths.registers.A = ths.mmu.read(++ths.registers.PC);
				return 8;
			case 0x3F:
				// CCF - 4 cycles - complement Carry flag (set if unset, unset if set)
				// reset subtract and half-carry flag
				if ((ths.registers.F >> ths.CARRY_BIT) & 1) {
					ths.setFlagBit(ths.CARRY_BIT, false);
				} else {
					ths.setFlagBit(ths.CARRY_BIT, true);
				}
				ths.setFlagBit(ths.SUBTRACT_BIT, false);
				ths.setFlagBit(ths.HALF_CARRY_BIT, false);
				return 4;
			case 0x40:
				// LD B, B - 4 cycles - Load B into B - redundant, just return
				// cycles
				return 4;
			case 0x41:
				// LD B, C - 4 cycles - Load value in register C into register
				// B
				ths.registers.B = ths.registers.C;
				return 4;
			case 0x42:
				// LD B, D - 4 cycles - Load value in register D into register
				// B
				ths.registers.B = ths.registers.D;
				return 4;
			case 0x43:
				// LD B, E - 4 cycles - Load value in register E into register
				// B
				ths.registers.B = ths.registers.E;
				return 4;
			case 0x44:
				// LD B, H - 4 cycles - Load value in register H into register
				// B
				ths.registers.B = ths.registers.H;
				return 4;
			case 0x45:
				// LD B, L - 4 cycles - Load value in register L into register
				// B
				ths.registers.B = ths.registers.L;
				return 4;
			case 0x46:
				// LD B, (HL) - 8 cycles - Load value in memory address found in
				// HL into B
				var address = (ths.registers.H << 8) ^ ths.registers.L;
				ths.registers.B = ths.mmu.read(address);
				return 8;
			case 0x47:
				// LD B, A - 4 cycles - Load value in register A into register
				// B
				ths.registers.B = ths.registers.A;
				return 4;
			case 0x48:
				// LD C, B - 4 cycles - Load value in register B into register
				// C
				ths.registers.C = ths.registers.B;
				return 4;
			case 0x49:
				// LD C, C - 4 cycles - Load C in C - redundant so just return cycles
				return 4;
			case 0x4A:
				// LD C, A - 4 cycles - Load value in register A into register
				// C
				ths.registers.C = ths.registers.A;
				return 4;
			case 0x4B:
				// LD C, E - 4 cycles - Load value in register E into register
				// C
				ths.registers.C = ths.registers.E;
				return 4;
			case 0x4C:
				// LD C, H - 4 cycles - Load value in register H into register
				// C
				ths.registers.C = ths.registers.H;
				return 4;
			case 0x4D:
				// LD C, L - 4 cycles - Load value in register L into register
				// C
				ths.registers.C = ths.registers.L;
				return 4;
			case 0x4E:
				// LD C, (HL) - 8 cycles - Load value in memory address found in
				// HL into C
				var address = (ths.registers.H << 8) ^ ths.registers.L;
				ths.registers.C = ths.mmu.read(address);
				return 8;
			case 0x4F:
				// LD C, A - 4 cycles - Load value in register A into register
				// C
				ths.registers.C = ths.registers.A;
				return 4;
			case 0x50:
				// LD D, B - 4 cycles - Load value in register B into register
				// D
				ths.registers.D = ths.registers.B;
				return 4;
			case 0x51:
				// LD D, C - 4 cycles - Load value in register C into register
				// D
				ths.registers.D = ths.registers.C;
				return 4;
			case 0x52:
				// LD D, D - 4 cycles - Load D in D - redundant
				return 4;
			case 0x53:
				// LD D, E - 4 cycles - Load value in register E into register
				// D
				ths.registers.D = ths.registers.E;
				return 4;
			case 0x54:
				// LD D, H - 4 cycles - Load value in register H into register
				// D
				ths.registers.D = ths.registers.H;
				return 4;
			case 0x55:
				// LD D, L - 4 cycles - Load value in register L into register
				// D
				ths.registers.D = ths.registers.L;
				return 4;
			case 0x56:
				// LD D, (HL) - 8 cycles - Load value in memory address found in
				// HL into D
				var address = (ths.registers.H << 8) ^ ths.registers.L;
				ths.registers.D = ths.mmu.read(address);
				return 8;
			case 0x57:
				// LD D, A - 4 cycles - Load value in register A into register
				// D
				ths.registers.D = ths.registers.A;
				return 4;
			case 0x58:
				// LD E, B - 4 cycles - Load value in register B into register
				// E
				ths.registers.E = ths.registers.B;
				return 4;
			case 0x59:
				// LD E, C - 4 cycles - Load value in register C into register
				// E
				ths.registers.E = ths.registers.C;
				return 4;
			case 0x5A:
				// LD E, D - 4 cycles - Load value in register D into register
				// E
				ths.registers.E = ths.registers.D;
				return 4;
			case 0x5B:
				// LD E, E - 4 cycles - Load E in E - redundant
				return 4;
			case 0x5C:
				// LD E, H - 4 cycles - Load value in register H into register
				// E
				ths.registers.E = ths.registers.H;
				return 4;
			case 0x5D:
				// LD E, L - 4 cycles - Load value in register L into register
				// E
				ths.registers.E = ths.registers.L;
				return 4;
			case 0x5E:
				// LD E, (HL) - 8 cycles - Load value in memory address found in
				// HL into E
				var address = (ths.registers.H << 8) ^ ths.registers.L;
				ths.registers.E = ths.mmu.read(address);
				return 8;
			case 0x5F:
				// LD E, A - 4 cycles - Load value in register A into register
				// E
				ths.registers.E = ths.registers.A;
				return 4;
			case 0x60:
				// LD H, B - 4 cycles - Load value in register B into register
				// H
				ths.registers.H = ths.registers.B;
				return 4;
			case 0x61:
				// LD H, C - 4 cycles - Load value in register C into register
				// H
				ths.registers.H = ths.registers.C;
				return 4;
			case 0x62:
				// LD H, D - 4 cycles - Load value in register D into register
				// H
				ths.registers.H = ths.registers.D;
				return 4;
			case 0x63:
				// LD H, E - 4 cycles - Load value in register E into register
				// H
				ths.registers.H = ths.registers.E;
				return 4;
			case 0x64:
				// LD H, H - 4 cycles - Load H in H - redundant
				return 4;
			case 0x65:
				// LD H, L - 4 cycles - Load value in register L into register
				// H
				ths.registers.H = ths.registers.L;
				return 4;
			case 0x66:
				// LD H, (HL) - 8 cycles - Load value in memory address found in
				// HL into H
				var address = (ths.registers.H << 8) ^ ths.registers.L;
				ths.registers.H = ths.mmu.read(address);
				return 8;
			case 0x67:
				// LD H, A - 4 cycles - Load value in register A into register
				// H
				ths.registers.H = ths.registers.A;
				return 4;
			case 0x68:
				// LD L, B - 4 cycles - Load value in register B into register
				// L
				ths.registers.L = ths.registers.B;
				return 4;
			case 0x69:
				// LD L, C - 4 cycles - Load value in register C into register
				// L
				ths.registers.L = ths.registers.C;
				return 4;
			case 0x6A:
				// LD L, D - 4 cycles - Load value in register D into register
				// L
				ths.registers.L = ths.registers.D;
				return 4;
			case 0x6B:
				// LD L, E - 4 cycles - Load value in register E into register
				// L
				ths.registers.L = ths.registers.E;
				return 4;
			case 0x6C:
				// LD L, H - 4 cycles - Load value in register H into register
				// L
				ths.registers.L = ths.registers.H;
				return 4;
			case 0x6D:
				// LD L, L - 4 cycles - redundant
				return 4;
			case 0x6E:
				// LD L, (HL) - 8 cycles - Load value in memory address found in
				// HL into L
				var address = (ths.registers.H << 8) ^ ths.registers.L;
				ths.registers.L = ths.mmu.read(address);
				return 8;
			case 0x6F:
				// LD L, A - 4 cycles - Load value in register A into register
				// L
				ths.registers.L = ths.registers.A;
				return 4;
			case 0x70:
				// LD (HL), B - 8 cycles - Load value in register B into memory
				// address found in HL
				var address = (ths.registers.H << 8) ^ ths.registers.L;
				ths.mmu.write(address, ths.registers.B);
				return 8;
			case 0x71:
				// LD (HL), C - 8 cycles - Load value in register C into memory
				// address found in HL
				var address = (ths.registers.H << 8) ^ ths.registers.L;
				ths.mmu.write(address, ths.registers.C);
				return 8;
			case 0x72:
				// LD (HL), D - 8 cycles - Load value in register D into memory
				// address found in HL
				var address = (ths.registers.H << 8) ^ ths.registers.L;
				ths.mmu.write(address, ths.registers.D);
				return 8;
			case 0x73:
				// LD (HL), E - 8 cycles - Load value in register E into memory
				// address found in HL
				var address = (ths.registers.H << 8) ^ ths.registers.L;
				ths.mmu.write(address, ths.registers.E);
				return 8;
			case 0x74:
				// LD (HL), H - 8 cycles - Load value in register H into memory
				// address found in HL
				var address = (ths.registers.H << 8) ^ ths.registers.L;
				ths.mmu.write(address, ths.registers.H);
				return 8;
			case 0x75:
				// LD (HL), L - 8 cycles - Load value in register L into memory
				// address found in HL
				var address = (ths.registers.H << 8) ^ ths.registers.L;
				ths.mmu.write(address, ths.registers.L);
				return 8;
			case 0x76:
				// HALT - 4 cycles - Halt CPU until an interrupt occurs
				console.log("Halted!");
				ths.halted = true;
				return 4;
			case 0x77:
				// LD (HL), A - 8 cycles - Load value in register A into memory
				// address found in HL
				var address = (ths.registers.H << 8) ^ ths.registers.A;
				ths.mmu.write(address, ths.registers.A);
				return 8;
			case 0x78:
				// LD A, B - 4 cycles - Load value in register B into register
				// A
				ths.registers.A = ths.registers.B;
				return 4;
			case 0x79:
				// LD A, C - 4 cycles - Load value in register C into register
				// A
				ths.registers.A = ths.registers.C;
				return 4;
			case 0x7A:
				// LD A, D - 4 cycles - Load value in register D into register
				// A
				ths.registers.A = ths.registers.D;
				return 4;
			case 0x7B:
				// LD A, E - 4 cycles - Load value in register E into register
				// A
				ths.registers.A = ths.registers.E;
				return 4;
			case 0x7C:
				// LD A, H - 4 cycles - Load value in register H into register
				// A
				ths.registers.A = ths.registers.H;
				return 4;
			case 0x7D:
				// LD A, L - 4 cycles - Load value in register L into register
				// A
				ths.registers.A = ths.regsiters.L;
				return 4;
			case 0x7E:
				// LD A, (HL) - 8 cycles - Load value in memory address found in
				// HL into A
				var address = (ths.registers.H << 8) ^ ths.registers.L;
				ths.registers.A = ths.mmu.read(address);
				return 8;
			case 0x7F:
				// LD A, A - 4 cycles - Load A in A - redundant
				return 4;
			case 0x80:
				// ADD A, B - 4 cycles - Add value in B to value in A respecting
				// flags being set
				ths.registers.A = ths.add8Bit(ths.registers.A, ths.registers.B);
				return 4;
			case 0x81:
				// ADD A, C - 4 cycles - Add value in C to value in A respecting
				// flags being set
				ths.registers.A = ths.add8Bit(ths.registers.A, ths.registers.C);
				return 4;
			case 0x82:
				// ADD A, D - 4 cycles - Add value in D to value in A respecting
				// flags being set
				ths.registers.A = ths.add8Bit(ths.registers.A, ths.registers.D);
				return 4;
			case 0x83:
				// ADD A, E - 4 cycles - Add value in E to value in A respecting
				// flags being set
				ths.registers.A = ths.add8Bit(ths.registers.A, ths.registers.E);
				return 4;
			case 0x84:
				// ADD A, H - 4 cycles - Add value in H to value in A respecting
				// flags being set
				ths.registers.A = ths.add8Bit(ths.registers.A, ths.registers.H);
				return 4;
			case 0x85:
				// ADD A, L - 4 cycles - Add value in L to value in A respecting
				// flags being set
				ths.registers.A = ths.add8Bit(ths.registers.A, ths.registers.L);
				return 4;
			case 0x86:
				// ADD A, (HL) - 8 cycles - Add value at memory address found in HL
				// to A
				var address = (ths.registers.H << 8) ^ ths.registers.L;
				ths.registers.A = ths.add8Bit(ths.registers.A, ths.mmu.read(address));
				return 8;
			case 0x87:
				// ADD A, A - 4 cycles - Add value in A to value in A respecting
				// flags being set
				ths.registers.A = ths.add8Bit(ths.registers.A, ths.registers.A);
				return 4;
			case 0x88:
				// ADC A, B - 4 cycles - Add value in B to value in A respecting
				// flags being set, add carry bit as well
				ths.registers.A = ths.add8Bit(ths.registers.A, ths.registers.B, true);
				return 4;
			case 0x89:
				// ADC A, C - 4 cycles - Add value in C to value in A respecting
				// flags being set, add carry bit as well
				ths.registers.A = ths.add8Bit(ths.registers.A, ths.registers.C, true);
				return 4;
			case 0x8A:
				// ADC A, D - 4 cycles - Add value in D to value in A respecting
				// flags being set, add carry bit as well
				ths.registers.A = ths.add8Bit(ths.registers.A, ths.registers.D, true);
				return 4;
			case 0x8B:
				// ADC A, E - 4 cycles - Add value in E to value in A respecting
				// flags being set, add carry bit as well
				ths.registers.A = ths.add8Bit(ths.registers.A, ths.registers.E, true);
				return 4;
			case 0x8C:
				// ADC A, H - 4 cycles - Add value in H to value in A respecting
				// flags being set, add carry bit as well
				ths.registers.A = ths.add8Bit(ths.registers.A, ths.registers.H, true);
				return 4;
			case 0x8D:
				// ADC A, L - 4 cycles - Add value in L to value in A respecting
				// flags being set, add carry bit as well
				ths.registers.A = ths.add8Bit(ths.registers.A, ths.registers.L, true);
				return 4;
			case 0x8E:
				// ADC A, (HL) - 8 cycles - Add value at memory address found in HL
				// to A, add carry bit as well
				var address = (ths.registers.H << 8) ^ ths.registers.L;
				ths.registers.A = ths.add8Bit(ths.registers.A, ths.mmu.read(address), true);
				return 8;
			case 0x8F:
				// ADC A, A - 4 cycles - Add value in A to value in A respecting
				// flags being set, add carry bit as well
				ths.registers.A = ths.add8Bit(ths.registers.A, ths.registers.A, true);
				return 4;
			case 0x90:
				// SUB A, B - 4 cycles - Subtract value in B from value in A respecting
				// flags being set
				ths.registers.A = ths.sub8Bit(ths.registers.A, ths.registers.B);
				return 4;
			case 0x91:
				// SUB A, C - 4 cycles - Subtract value in C from value in A respecting
				// flags being set
				ths.registers.A = ths.sub8Bit(ths.registers.A, ths.registers.C);
				return 4;
			case 0x92:
				// SUB A, D - 4 cycles - Subtract value in D from value in A respecting
				// flags being set
				ths.registers.A = ths.sub8Bit(ths.registers.A, ths.registers.D);
				return 4;
			case 0x93:
				// SUB A, E - 4 cycles - Subtract value in E from value in A respecting
				// flags being set
				ths.registers.A = ths.sub8Bit(ths.registers.A, ths.registers.E);
				return 4;
			case 0x94:
				// SUB A, H - 4 cycles - Subtract value in H from value in A respecting
				// flags being set
				ths.registers.A = ths.sub8Bit(ths.registers.A, ths.registers.H);
				return 4;
			case 0x95:
				// SUB A, L - 4 cycles - Subtract value in L from value in A respecting
				// flags being set
				ths.registers.A = ths.sub8Bit(ths.registers.A, ths.registers.L);
				return 4;
			case 0x96:
				// SUB A, (HL) - 8 cycles - Subtact value at memory address found in HL
				// from A
				var address = (ths.registers.H << 8) ^ ths.registers.L;
				ths.registers.A = ths.sub8Bit(ths.registers.A, ths.mmu.read(address));
				return 8;
			case 0x97:
				// SUB A, A - 4 cycles - Subtract value in A from value in A respecting
				// flags being set
				ths.registers.A = ths.sub8Bit(ths.registers.A, ths.registers.A);
				return 4;
			case 0x98:
				// SBC A, B - 4 cycles - Subtract value in B from value in A respecting
				// flags being set, add carry bit as well
				ths.registers.A = ths.sub8Bit(ths.registers.A, ths.registers.B, true);
				return 4;
			case 0x99:
				// SBC A, C - 4 cycles - Subtract value in C from value in A respecting
				// flags being set, add carry bit as well
				ths.registers.A = ths.sub8Bit(ths.registers.A, ths.registers.C, true);
				return 4;
			case 0x9A:
				// SBC A, D - 4 cycles - Subtract value in D from value in A respecting
				// flags being set, add carry bit as well
				ths.registers.A = ths.sub8Bit(ths.registers.A, ths.registers.D, true);
				return 4;
			case 0x9B:
				// SBC A, E - 4 cycles - Subtract value in E from value in A respecting
				// flags being set, add carry bit as well
				ths.registers.A = ths.sub8Bit(ths.registers.A, ths.registers.E, true);
				return 4;
			case 0x9C:
				// SBC A, H - 4 cycles - Subtract value in H from value in A respecting
				// flags being set, add carry bit as well
				ths.registers.A = ths.sub8Bit(ths.registers.A, ths.registers.H, true);
				return 4;
			case 0x9D:
				// SBC A, L - 4 cycles - Subtract value in L from value in A respecting
				// flags being set, add carry bit as well
				ths.registers.A = ths.sub8Bit(ths.registers.A, ths.registers.L, true);
				return 4;
			case 0x9E:
				// SBC A, (HL) - 8 cycles - Subtract value at memory address found in HL
				// from A, add carry bit as well
				var address = (ths.registers.H << 8) ^ ths.registers.L;
				ths.registers.A = ths.sub8Bit(ths.registers.A, ths.mmu.read(address), true);
				return 8;
			case 0x9F:
				// SBC A, A - 4 cycles - Subtract value in A from value in A respecting
				// flags being set, add carry bit as well
				ths.registers.A = ths.sub8Bit(ths.registers.A, ths.registers.A, true);
				return 4;
			case 0xA0:
				// AND B - 4 cycles - Logically AND B with A and store in A
				ths.registers.A = ths.andRegisters(ths.registers.A, ths.registers.B);
				return 4;
			case 0xA1:
				// AND C - 4 cycles - Logically AND C with A and store in A
				ths.registers.A = ths.andRegisters(ths.registers.A, ths.registers.C);
				return 4;
			case 0xA2:
				// AND D - 4 cycles - Logically AND D with A and store in A
				ths.registers.A = ths.andRegisters(ths.registers.A, ths.registers.D);
				return 4;
			case 0xA3:
				// AND E - 4 cycles - Logically AND E with A and store in A
				ths.registers.A = ths.andRegisters(ths.registers.A, ths.registers.E);
				return 4;
			case 0xA4:
				// AND H - 4 cycles - Logically AND H with A and store in A
				ths.registers.A = ths.andRegisters(ths.registers.A, ths.registers.H);
				return 4;
			case 0xA5:
				// AND L - 4 cycles - Logically AND L with A and store in A
				ths.registers.A = ths.andRegisters(ths.registers.A, ths.registers.L);
				return 4;
			case 0xA6:
				// AND (HL) - 8 cycles - Logically AND the value in HL with A and store in A
				var address = (ths.registers.H << 8) ^ ths.registers.L;
				ths.registers.A = ths.andRegisters(ths.registers.A, ths.mmu.read(address));
				return 8;
			case 0xA7:
				// AND B - 4 cycles - Logically AND A with A and store in A
				ths.registers.A = ths.andRegisters(ths.registers.A, ths.registers.A);
				return 4;
			case 0xA8:
				// XOR B - 4 cycles - Logically XOR B with A and store in A
				ths.registers.A = ths.xorRegisters(ths.registers.A, ths.registers.B);
				return 4;
			case 0xA9:
				// XOR C - 4 cycles - Logically XOR C with A and store in A
				ths.registers.A = ths.xorRegisters(ths.registers.A, ths.registers.C);
				return 4;
			case 0xAA:
				// XOR D - 4 cycles - Logically XOR D with A and store in A
				ths.registers.A = ths.xorRegisters(ths.registers.A, ths.registers.D);
				return 4;
			case 0xAB:
				// XOR E - 4 cycles - Logically XOR E with A and store in A
				ths.registers.A = ths.xorRegisters(ths.registers.A, ths.registers.E);
				return 4;
			case 0xAC:
				// XOR H - 4 cycles - Logically XOR H with A and store in A
				ths.registers.A = ths.xorRegisters(ths.registers.A, ths.registers.H);
				return 4;
			case 0xAD:
				// XOR L - 4 cycles - Logically XOR L with A and store in A
				ths.registers.A = ths.xorRegisters(ths.registers.A, ths.registers.L);
				return 4;
			case 0xAE:
				// XOR (HL) - 8 cycles - Logically XOR the value in HL with A and store in A
				var address = (ths.registers.H << 8) ^ ths.registers.L;
				ths.registers.A = ths.xorRegisters(ths.registers.A, ths.mmu.read(address));
				return 8;
			case 0xAF:
				// XOR B - 4 cycles - Logically XOR A with A and store in A
				ths.registers.A = ths.xorRegisters(ths.registers.A, ths.registers.A);
				return 4;
			case 0xB0:
				// OR B - 4 cycles - Logically OR B with A and store in A
				ths.registers.A = ths.orRegisters(ths.registers.A, ths.registers.B);
				return 4;
			case 0xB1:
				// OR C - 4 cycles - Logically OR C with A and store in A
				ths.registers.A = ths.orRegisters(ths.registers.A, ths.registers.C);
				return 4;
			case 0xB2:
				// OR D - 4 cycles - Logically OR D with A and store in A
				ths.registers.A = ths.orRegisters(ths.registers.A, ths.registers.D);
				return 4;
			case 0xB3:
				// OR E - 4 cycles - Logically OR E with A and store in A
				ths.registers.A = ths.orRegisters(ths.registers.A, ths.registers.E);
				return 4;
			case 0xB4:
				// OR H - 4 cycles - Logically OR H with A and store in A
				ths.registers.A = ths.orRegisters(ths.registers.A, ths.registers.H);
				return 4;
			case 0xB5:
				// OR L - 4 cycles - Logically OR L with A and store in A
				ths.registers.A = ths.orRegisters(ths.registers.A, ths.registers.L);
				return 4;
			case 0xB6:
				// OR (HL) - 8 cycles - Logically OR the value in HL with A and store in A
				var address = (ths.registers.H << 8) ^ ths.registers.L;
				ths.registers.A = ths.orRegisters(ths.registers.A, ths.mmu.read(address));
				return 8;
			case 0xB7:
				// OR B - 4 cycles - Logically OR A with A and store in A
				ths.registers.A = ths.orRegisters(ths.registers.A, ths.registers.A);
				return 4;
			case 0xB8:
				// CP A, B - 4 cycles - Subtract value in B from value in A but throw away result
				ths.sub8Bit(ths.registers.A, ths.registers.B);
				return 4;
			case 0xB9:
				// CP A, C - 4 cycles - Subtract value in C from value in A but throw away result
				ths.sub8Bit(ths.registers.A, ths.registers.C);
				return 4;
			case 0xBA:
				// CP A, D - 4 cycles - Subtract value in D from value in A but throw away result
				ths.sub8Bit(ths.registers.A, ths.registers.D);
				return 4;
			case 0xBB:
				// CP A, E - 4 cycles - Subtract value in E from value in A but throw away result
				ths.sub8Bit(ths.registers.A, ths.registers.E);
				return 4;
			case 0xBC:
				// CP A, H - 4 cycles - Subtract value in H from value in A but throw away result
				ths.sub8Bit(ths.registers.A, ths.registers.H);
				return 4;
			case 0xBD:
				// CP A, L - 4 cycles - Subtract value in L from value in A but throw away result
				ths.sub8Bit(ths.registers.A, ths.registers.L);
				return 4;
			case 0xBE:
				// CP A, (HL) - 8 cycles - Subtract value at memory address found in HL
				// from A but throw away result
				var address = (ths.registers.H << 8) ^ ths.registers.L;
				ths.sub8Bit(ths.registers.A, ths.mmu.read(address));
				return 8;
			case 0xBF:
				// CP A, A - 4 cycles - Subtract value in A from value in A but throw away result
				ths.sub8Bit(ths.registers.A, ths.registers.A);
				return 4;
			case 0xC0:
				// RET NZ - 8 cycles - Return if zero flag is not set
				var zeroBit = (ths.registers.F >> ths.ZERO_BIT) & 1;
				var lower = ths.popFromStack();
				var upper = ths.popFromStack();
				if (!zeroBit) {
					ths.registers.PC = ((upper << 8) ^ lower) - 1;
				}
				return 8;
			case 0xC1:
				// POP BC - 12 cycles - Pop two bytes from stack and store in register pair BC
				ths.registers.C = ths.popFromStack();
				ths.registers.B = ths.popFromStack();
				return 12;
			case 0xC2:
				// JP NZ, a16 - 12 cycles - Jump to address found in next two bytes if zero
				// flag is not set
				var addressHi = ths.mmu.read(++ths.registers.PC);
				var addressLo = ths.mmu.read(++ths.registers.PC);
				var address = (addressHi << 8) ^ addressLo;
				var zeroBit = (ths.registers.F >> ths.ZERO_BIT) & 1;
				if (!zeroBit) {
					ths.registers.PC = address - 1;
				}
				return 12;
			case 0xC3:
				// JP a16 - 12 cycles - Jump to address found in next two bytes
				var addressHi = ths.mmu.read(++ths.registers.PC);
				var addressLo = ths.mmu.read(++ths.registers.PC);
				var address = (addressHi << 8) ^ addressLo;
				ths.registers.PC = address - 1;
				return 12;
			case 0xC4:
				// CALL NZ, a16 - 12 cycles - Call address found in next two bytes if zero
				// bit is not set
				var addressHi = ths.mmu.read(++ths.registers.PC);
				var addressLo = ths.mmu.read(++ths.registers.PC);
				var address = (addressHi << 8) ^ addressLo;
				var zeroBit = (ths.registers.F >> ths.ZERO_BIT) & 1;
				if (!zeroBit) {
					ths.pushToStack(ths.registers.PC >> 8);
					ths.pushToStack(ths.registers.PC & 0xFF);
					ths.registers.PC = address - 1;
				}
				return 12;
			case 0xC5:
				// PUSH BC - 16 cycles - Push register pair onto stack
				ths.pushToStack(ths.registers.B);
				ths.pushToStack(ths.registers.C);
				return 16;
			case 0xC6:
				// ADD A, d8 - 8 cycles - add data in next byte into register A
				var data = ths.mmu.read(++ths.registers.PC);
				ths.registers.A = ths.add8Bit(ths.registers.A, data);
				return 8;
			case 0xC7:
				// RST 00H - 32 cycles - Push present address onto stack and jump
				// to address $0000 + $00
				ths.pushToStack(ths.registers.PC >> 8);
				ths.pushToStack(ths.registers.PC & 0xFF);
				ths.registers.PC = -1;
				return 32;
			case 0xC8:
				// RET Z - 8 cycles - Return if zero flag is  set
				var zeroBit = (ths.registers.F >> the.ZERO_BIT) & 1;
				var lower = ths.popFromStack();
				var upper = ths.popFromStack();
				if (zeroBit) {
					ths.registers.PC = ((upper << 8) ^ lower) - 1;
				}
				return 8;
			case 0xC9:
				// RET - 8 cycles - Pop two bytes from stack and return to that address
				var lower = ths.popFromStack();
				var upper = ths.popFromStack();
				ths.registers.PC = ((upper << 8) ^ lower) - 1;
				return 8;
			case 0xCA:
				// JP Z, a16 - 12 cycles - Jump to address found in next two bytes if zero
				// flag is set
				var addressHi = ths.mmu.read(++ths.registers.PC);
				var addressLo = ths.mmu.read(++ths.registers.PC);
				var address = (addressHi << 8) ^ addressLo;
				var zeroBit = (ths.registers.F >> the.ZERO_BIT) & 1;
				if (zeroBit) {
					ths.registers.PC = address - 1;
				}
				return 12;
			case 0xCB:
				// PREFIX CB - We need to call other op code table
				console.log("SECOND TABLE");
				return ths.executePrefixOperation(ths.mmu.read(++ths.registers.PC));
			case 0xCC:
				// CALL Z, a16 - 12 cycles - Call address found in next two bytes if zero
				// bit is set
				var addressHi = ths.mmu.read(++ths.registers.PC);
				var addressLo = ths.mmu.read(++ths.registers.PC);
				var address = (addressHi << 8) ^ addressLo;
				var zeroBit = (ths.registers.F >> ths.ZERO_BIT) & 1;
				if (zeroBit) {
					ths.pushToStack(ths.registers.PC >> 8);
					ths.pushToStack(ths.registers.PC & 0xFF);
					ths.registers.PC = address - 1;
				}
				return 12;
			case 0xCD:
				// CALL a16 - 12 cycles - Push PC onto stack and then call address
				// found in next two bytes
				var addressHi = ths.mmu.read(++ths.registers.PC);
				var addressLo = ths.mmu.read(++ths.registers.PC);
				var address = (addressHi << 8) ^ addressLo;
				ths.pushToStack(ths.registers.PC >> 8);
				ths.pushToStack(ths.registers.PC & 0xFF);
				ths.registers.PC = address - 1;
				return 12;
			case 0xCE:
				// ADC A, d8 - 8 cycles - add data in next byte into register A along
				// with the carry
				var data = ths.mmu.read(++ths.registers.PC);
				ths.registers.A = ths.add8Bit(ths.registers.A, data, true);
				return 8;
			case 0xCF:
				// RST 08H - 32 cycles - Push present address onto stack and jump
				// to address $0000 + $08
				ths.pushToStack(ths.registers.PC >> 8);
				ths.pushToStack(ths.registers.PC & 0xFF);
				ths.registers.PC = 0x08 - 1;
				return 32;
			case 0xD0:
				// RET NC - 8 cycles - Return if carry flag is not set
				var carryBit = (ths.registers.F >> the.CARRY_BIT) & 1;
				var lower = ths.popFromStack();
				var upper = ths.popFromStack();
				if (!carryBit) {
					ths.registers.PC = ((upper << 8) ^ lower) - 1;
				}
				return 8;
			case 0xD1:
				// POP DE - 12 cycles - Pop two bytes from stack and store in register pair DE
				ths.registers.E = ths.popFromStack();
				ths.registers.D = ths.popFromStack();
				return 12;
			case 0xD2:
				// JP NC, a16 - 12 cycles - Jump to address found in next two bytes if carry
				// flag is not set
				var addressHi = ths.mmu.read(++ths.registers.PC);
				var addressLo = ths.mmu.read(++ths.registers.PC);
				var address = (addressHi << 8) ^ addressLo;
				var carryBit = (ths.registers.F >> ths.CARRY_BIT) & 1;
				if (!carryBit) {
					ths.registers.PC = address - 1;
				}
				return 12;
			case 0xD4:
				// CALL NC, a16 - 12 cycles - Call address found in next two bytes if carry
				// bit is not set
				var addressHi = ths.mmu.read(++ths.registers.PC);
				var addressLo = ths.mmu.read(++ths.registers.PC);
				var address = (addressHi << 8) ^ addressLo;
				var carryBit = (ths.registers.F >> ths.CARRY_BIT) & 1;
				if (!carryBit) {
					ths.pushToStack(ths.registers.PC >> 8);
					ths.pushToStack(ths.registers.PC & 0xFF);
					ths.registers.PC = address - 1;
				}
				return 12;
			case 0xD5:
				// PUSH DE - 16 cycles - Push register pair onto stack
				ths.pushToStack(ths.registers.D);
				ths.pushToStack(ths.registers.E);
				return 16;
			case 0xD6:
				// SUB d8 - 8 cycles - subtracy data in next byte from register A
				var data = ths.mmu.read(++ths.registers.PC);
				ths.registers.A = ths.sub8Bit(ths.registers.A, data);
				return 8;
			case 0xD7:
				// RST 10H - 32 cycles - Push present address onto stack and jump
				// to address $0000 + $08
				ths.pushToStack(ths.registers.PC >> 8);
				ths.pushToStack(ths.registers.PC & 0xFF);
				ths.registers.PC = 0x10 - 1;
				return 32;
			case 0xD8:
				// RET C - 8 cycles - Return if carry flag is  set
				var carryBit = (ths.registers.F >> the.CARRY_BIT) & 1;
				var lower = ths.popFromStack();
				var upper = ths.popFromStack();
				if (carryBit) {
					ths.registers.PC = ((upper << 8) ^ lower) - 1;
				}
				return 8;
			case 0xD9:
				// RETI - 8 cycles - Pop two bytes from stack and return to that address
				// and then enable interrupts
				var lower = ths.popFromStack();
				var upper = ths.popFromStack();
				ths.registers.PC = ((upper << 8) ^ lower) - 1;
				ths.interruptsEnabled = true;
				return 8;
			case 0xDA:
				// JP C, a16 - 12 cycles - Jump to address found in next two bytes if zero
				// flag is set
				var addressHi = ths.mmu.read(++ths.registers.PC);
				var addressLo = ths.mmu.read(++ths.registers.PC);
				var address = (addressHi << 8) ^ addressLo;
				var carryBit = (ths.registers.F >> the.CARRY_BIT) & 1;
				if (carryBit) {
					ths.registers.PC = address - 1;
				}
				return 12;
			case 0xDC:
				// CALL C, a16 - 12 cycles - Call address found in next two bytes if zero
				// bit is set
				var addressHi = ths.mmu.read(++ths.registers.PC);
				var addressLo = ths.mmu.read(++ths.registers.PC);
				var address = (addressHi << 8) ^ addressLo;
				var carryBit = (ths.registers.F >> ths.CARRY_BIT) & 1;
				if (carryBit) {
					ths.pushToStack(ths.registers.PC >> 8);
					ths.pushToStack(ths.registers.PC & 0xFF);
					ths.registers.PC = address - 1;
				}
				return 12;
			case 0xDE:
				// SBC A, d8 - 8 cycles - subtracy data in next byte from register A along
				// with the carry
				var data = ths.mmu.read(++ths.registers.PC);
				ths.registers.A = ths.sub8Bit(ths.registers.A, data, true);
				return 8;
			case 0xDF:
				// RST 18H - 32 cycles - Push present address onto stack and jump
				// to address $0000 + $18
				ths.pushToStack(ths.registers.PC >> 8);
				ths.pushToStack(ths.registers.PC & 0xFF);
				ths.registers.PC = 0x18 - 1;
				return 32;
			case 0xE0:
				// LDH (a8), A - 12 cycles - Load value in A into memory address
				// 0xFF00 + next byte in the queue
				var offset = ths.mmu.read(++ths.registers.PC);
				ths.mmu.write(0xFF00 + offset, ths.registers.A);
				return 12;
			case 0xE1:
				// POP HL - 12 cycles - Pop two bytes from stack and store in register pair HL
				ths.registers.L = ths.popFromStack();
				ths.registers.H = ths.popFromStack();
				return 12;
			case 0xE2:
				// LD (C), A - 8 cycles - Put A into address 0xFF00 + address in C
				var address = 0xFF00 + ths.registers.C;
				ths.mmu.write(address, ths.registers.A);
				return 8;
			case 0xE5:
				// PUSH HL - 16 cycles - Push register pair HL onto stack
				ths.pushToStack(ths.registers.H);
				ths.pushToStack(ths.registers.L);
				return 16;
			case 0xE6:
				// AND d8 - 8 cycles - Logical and data in next byte with register A along
				var data = ths.mmu.read(++ths.registers.PC);
				ths.registers.A = ths.andRegisters(ths.registers.A, data);
				return 8;
			case 0xE7:
				// RST 20H - 32 cycles - Push present address onto stack and jump
				// to address $0000 + $20
				ths.pushToStack(ths.registers.PC >> 8);
				ths.pushToStack(ths.registers.PC & 0xFF);
				ths.registers.PC = 0x20 - 1;
				return 32;
			case 0xE8:
				// ADD SP, r8 - 16 cycles - Add one byte signed value which is next
				// in the queue to the stack pointer.
				// Reset zero flag, Reset subtract flag and set or reset half-carry
				// and carry accordingly
				var toAdd = ths.mmu.read(++ths.registers.PC);
				if (toAdd > 127) toAdd = -(128 - (toAdd - 128));
				var newVal = ths.registers.SP + toAdd;

				ths.setFlagBit(ths.SUBTRACT_BIT, false);
				ths.setFlagBit(ths.ZERO_BIT, false);
				var halfCarry = ((toAdd & 0xFF00) & 0xF) + ((toAdd >> 8) & 0xF);
				ths.setFlagBit(ths.HALF_CARRY_BIT, halfCarry);
				ths.setFlagBit(ths.CARRY_BIT, newVal > 0xFFFF);

				if (newVal > 0xFFFF) {
					newVal = newVal - 0xFFFF;
				}

				ths.registers.SP = newVal;
				return 16;
			case 0xE9:
				// JP (HL) - 4 cycles - Jump to the address in register pair HL
				var address = (ths.registers.H << 8) ^ ths.registers.L;
				ths.registers.PC = address - 1;
				return 4;
			case 0xEA:
				// LD (a16) A - 16 cycles - Load value in A into memory at address
				// found in next two bytes
				var addressHi = ths.mmu.read(++ths.registers.PC);
				var addressLo = ths.mmu.read(++ths.registers.PC);
				var address = (addressHi << 8) ^ addressLo;
				ths.mmu.write(address, ths.registers.A);
				return 16;
			case 0xEE:
				// XOR d8 - 8 cycles - Logical xor data in next byte with register A
				var data = ths.mmu.read(++ths.registers.PC);
				ths.registers.A = ths.xorRegisters(ths.registers.A, data);
				return 8;
			case 0xEF:
				// RST 28H - 32 cycles - Push present address onto stack and jump
				// to address $0000 + $28
				ths.pushToStack(ths.registers.PC >> 8);
				ths.pushToStack(ths.registers.PC & 0xFF);
				ths.registers.PC = 0x28 - 1;
				return 32;
			case 0xF0:
				// LDH A, (a8) - 12 cycles - Load data at memory address 0xFF00 +
				// the address found in next byte into register A
				var address = ths.mmu.read(++ths.registers.PC);
				ths.registers.A = ths.mmu.read(0xFF00 + address);
				return 12;
			case 0xF1:
				// POP AF - 12 cycles - Pop two bytes from stack and store in register pair DE
				ths.registers.F = ths.popFromStack();
				ths.registers.A = ths.popFromStack();
				return 12;
			case 0xF2:
				// LD A, (C) - 8 cycles - Put value at 0xFF00 + address found in register C
				// into register A
				var data = ths.mmu.read(0xFF00 + ths.registers.C);
				ths.registers.A = data;
				return 8;
			case 0xF3:
				// DI - 4 cycles - Need to disable interrupts after the next instruction
				ths.toDisableInterrupts += 1;
				return 4;
			case 0xF5:
				// PUSH AF - 16 cycles - Push register pair AF onto stack
				ths.pushToStack(ths.registers.A);
				ths.pushToStack(ths.registers.F);
				return 16;
			case 0xF6:
				// OR d8 - 8 cycles - Logical or data in next byte with register A
				var data = ths.mmu.read(++ths.registers.PC);
				ths.registers.A = ths.orRegisters(ths.registers.A, data);
				return 8;
			case 0xF7:
				// RST 30H - 32 cycles - Push present address onto stack and jump
				// to address $0000 + $30
				ths.pushToStack(ths.registers.PC >> 8);
				ths.pushToStack(ths.registers.PC & 0xFF);
				ths.registers.PC = 0x30 - 1;
				return 32;
			case 0xF8:
				// LD HL, SP + r8 - 12 cycles put address of stack pointer plus the
				// next signed byte into register pair HL
				// Reset zero flag, Reset subtract flag and set or reset half-carry
				// and carry accordingly
				var toAdd = ths.mmu.read(++ths.registers.PC);
				if (toAdd > 127) toAdd = -(128 - (toAdd - 128));
				var addressVal = ths.registers.SP + toAdd;

				ths.setFlagBit(ths.SUBTRACT_BIT, false);
				ths.setFlagBit(ths.ZERO_BIT, false);
				var halfCarry = ((toAdd & 0xFF00) & 0xF) + ((toAdd >> 8) & 0xF);
				ths.setFlagBit(ths.HALF_CARRY_BIT, halfCarry);
				ths.setFlagBit(ths.CARRY_BIT, addressVal > 0xFFFF);

				if (addressVal > 0xFFFF) {
					addressVal = addressVal - 0xFFFF;
				}

				ths.valueHi = addressVal >> 8;
				ths.valueLo = addressVal & 0xFF;
				ths.registers.H = valueHi;
				ths.registers.L = valueLo;
				return 12;
			case 0xF9:
				// LD SP, HL - 8 cycles - Load the value in HL into the stack pointer
				var resolvedVal = (ths.registers.H << 8) ^ ths.registers.L;
				ths.registers.SP = resolvedVal;
				return 8;
			case 0xFA:
				// LD A, (a16) - 16 cycles - Load value in address found in next two bytes
				// into register A
				var addressHi = ths.mmu.read(++ths.registers.PC);
				var addressLo = ths.mmu.read(++ths.registers.PC);
				var address = (addressHi << 8) ^ addressLo;
				ths.registers.A = ths.mmu.read(address);
				return 16;
			case 0xFB:
				// EI - 4 cycles - Need to enable interrupts after the next instruction
				ths.toEnableInterrupts += 1;
				return 4;
			case 0xFE:
				// CP d8 - 8 cycles - Subtract next byte in memory from register A but
				// throw away result
				var data = ths.mmu.read(++ths.registers.PC);
				ths.sub8Bit(ths.registers.A, data);
				return 8;
			case 0xFF:
				// RST 38H - 32 cycles - Push present address onto stack and jump
				// to address $0000 + $38
				ths.pushToStack(ths.registers.PC >> 8);
				ths.pushToStack(ths.registers.PC & 0xFF);
				ths.registers.PC = 0x38 - 1;
				return 32;
			default:
				return 0;
		}
	};

	this.doRlc = function(value) {
		// Rotate bits of value left and set the carry bit old bit 7
		// Subtract bit and half carry bit are reset, zero bit set if result is zero
		var currentBitSeven = (value >> 7) & 1;
		var newVal = (value << 1) & 255;

		// Roll old bit seven over to bit zero
		if (currentBitSeven) {
			newVal ^= 1;
		}

		ths.setFlagBit(ths.CARRY_BIT, currentBitSeven);
		ths.setFlagBit(ths.SUBTRACT_BIT, false);
		ths.setFlagBit(ths.HALF_CARRY_BIT, false);
		ths.setFlagBit(ths.ZERO_BIT, newVal === 0);

		return newVal;
	};

	this.doRrc = function(value) {
		// Rotate bits of value right and set the carry bit old bit 0
		// Subtract bit and half carry bit are reset, zero bit set if result is zero
		var currentBitZero = value & 1;
		var newVal = (value >> 1) & 255;

		// Roll old bit zero over to bit seven
		if (currentBitZero) {
			newVal ^= parseInt("10000000", 2);
		}

		ths.setFlagBit(ths.CARRY_BIT, currentBitZero);
		ths.setFlagBit(ths.SUBTRACT_BIT, false);
		ths.setFlagBit(ths.HALF_CARRY_BIT, false);
		ths.setFlagBit(ths.ZERO_BIT, newVal === 0);

		return newVal;
	};

	this.doRl = function(value) {
		// Rotate bits of value left through carry bit
		// Subtract bit and half carry bit are reset, zero bit set if result is zero
		var currentBitSeven = (value >> 7) & 1;
		var currentCarryBit = (ths.registers.F >> ths.CARRY_BIT) & 1;
		var newVal = (value << 1) & 255;

		// Roll old carry bit over to bit zero
		if (currentCarryBit) {
			newVal ^= 1;
		}

		ths.setFlagBit(ths.CARRY_BIT, currentBitSeven);
		ths.setFlagBit(ths.SUBTRACT_BIT, false);
		ths.setFlagBit(ths.HALF_CARRY_BIT, false);
		ths.setFlagBit(ths.ZERO_BIT, newVal === 0);

		return newVal;
	};

	this.doRr = function(value) {
		// Rotate bits of value right through carry bit
		// Subtract bit and half carry bit are reset, zero bit set if result is zero
		var currentBitZero = value & 1;
		var currentCarryBit = (ths.registers.F >> ths.CARRY_BIT) & 1;
		var newVal = (value >> 1) & 255;

		// Roll old carry over to bit seven
		if (currentCarryBit) {
			newVal ^= parseInt("10000000", 2);
		}

		ths.setFlagBit(ths.CARRY_BIT, currentBitZero);
		ths.setFlagBit(ths.SUBTRACT_BIT, false);
		ths.setFlagBit(ths.HALF_CARRY_BIT, false);
		ths.setFlagBit(ths.ZERO_BIT, newVal === 0);

		return newVal;
	};

	this.doSla = function(value) {
		// Shift bits of value left into carry
		// Subtract bit and half carry bit are reset, zero bit set if result is zero
		var currentBitSeven = (value >> 7) & 1;
		var newVal = (value << 1) & 255;

		ths.setFlagBit(ths.CARRY_BIT, currentBitSeven);
		ths.setFlagBit(ths.SUBTRACT_BIT, false);
		ths.setFlagBit(ths.HALF_CARRY_BIT, false);
		ths.setFlagBit(ths.ZERO_BIT, newVal === 0);

		return newVal;
	};

	this.doSra = function(value) {
		// Shift bits of value right into carry, bit 7 is unchanged
		// Subtract bit and half carry bit are reset, zero bit set if result is zero
		var currentBitSeven = (value >> 7) & 1;
		var currentBitZero = value & 1;
		var newVal = (value >> 1) & 255;

		// Make sure bit 7 is unchanged
		if (currentBitSeven) {
			newVal ^= parseInt("10000000", 2);
		}

		ths.setFlagBit(ths.CARRY_BIT, currentBitZero);
		ths.setFlagBit(ths.SUBTRACT_BIT, false);
		ths.setFlagBit(ths.HALF_CARRY_BIT, false);
		ths.setFlagBit(ths.ZERO_BIT, newVal === 0);

		return newVal;
	};

	this.doSwap = function(value) {
		// Swap upper and lower nibbles of value
		// Rests subtract, half-carry, and carry bits, zero bit is set if result is zero
		var upperNibble = value >> 4;
		var lowerNibble = value & 0xF;
		var newVal = (lowerNibble << 4) ^ upperNibble;

		ths.setFlagBit(ths.CARRY_BIT, false);
		ths.setFlagBit(ths.SUBTRACT_BIT, false);
		ths.setFlagBit(ths.HALF_CARRY_BIT, false);
		ths.setFlagBit(ths.ZERO_BIT, newVal === 0);

		return newVal;
	};

	this.doSrl = function(value) {
		// Shift bits of value right into carry
		// Subtract bit and half carry bit are reset, zero bit set if result is zero
		var currentBitZero = value & 1;
		var newVal = (value >> 1) & 255;

		ths.setFlagBit(ths.CARRY_BIT, currentBitZero);
		ths.setFlagBit(ths.SUBTRACT_BIT, false);
		ths.setFlagBit(ths.HALF_CARRY_BIT, false);
		ths.setFlagBit(ths.ZERO_BIT, newVal === 0);

		return newVal;
	};

	this.testBit = function(bit, value) {
		// BIT operation - Test if bit in register is set
		// zero bit is set if bit in value is zero, reset subtract bit, set half carry bit

		var isBitSet = (value >> bit) & 1;
		ths.setFlagBit(ths.SUBTRACT_BIT, false);
		ths.setFlagBit(ths.HALF_CARRY_BIT, true);
		ths.setFlagBit(ths.ZERO_BIT, isBitSet === 0);
	};

	this.resetBit = function(bit, value) {
		// RES operation - Reset bit in register
		return value &= ~(1 << bit);
	};

	this.setBit = function(bit, value) {
		// SET operation = Set bit in register
		return value |= (1 << bit);
	}

	this.executePrefixOperation = function(opcode) {
		switch (opcode) {
			case 0x0:
				// RLC B - 8 cycles - Rotate bits of register B left
				ths.registers.B = ths.doRlc(ths.registers.B);
				return 8;
			case 0x1:
				// RLC C - 8 cycles - Rotate bits of register C left
				ths.registers.C = ths.doRlc(ths.registers.C);
				return 8;
			case 0x2:
				// RLC D - 8 cycles - Rotate bits of register D left
				ths.registers.D = ths.doRlc(ths.registers.D);
				return 8;
			case 0x3:
				// RLC E - 8 cycles - Rotate bits of register E left
				ths.registers.E = ths.doRlc(ths.registers.E);
				return 8;
			case 0x4:
				// RLC H - 8 cycles - Rotate bits of register H left
				ths.registers.H = ths.doRlc(ths.registers.H);
				return 8;
			case 0x5:
				// RLC L - 8 cycles - Rotate bits of register L left
				ths.registers.L = ths.doRlc(ths.registers.L);
				return 8;
			case 0x6:
				// RLC (HL) - 16 cycles - Rotate bits of value in memory address found in HL left
				var address = (ths.registers.H << 8) ^ ths.registers.L;
				ths.mmu.write(address, ths.doRlc(ths.mmu.read(address)));
				return 16;
			case 0x7:
				// RLC A - 8 cycles - Rotate bits of register A left
				ths.registers.A = ths.doRlc(ths.registers.A);
				return 8;
			case 0x8:
				// RRC B - 8 cycles - Rotate bits of register B right
				ths.registers.B = ths.doRrc(ths.registers.B);
				return 8;
			case 0x9:
				// RRC C - 8 cycles - Rotate bits of register C right
				ths.registers.C = ths.doRrc(ths.registers.C);
				return 8;
			case 0xA:
				// RRC D - 8 cycles - Rotate bits of register D right
				ths.registers.D = ths.doRrc(ths.registers.D);
				return 8;
			case 0xB:
				// RRC E - 8 cycles - Rotate bits of register E right
				ths.registers.E = ths.doRrc(ths.registers.E);
				return 8;
			case 0xC:
				// RRC H - 8 cycles - Rotate bits of register H right
				ths.registers.H = ths.doRrc(ths.registers.H);
				return 8;
			case 0xD:
				// RRC L - 8 cycles - Rotate bits of register L right
				ths.registers.L = ths.doRrc(ths.registers.L);
				return 8;
			case 0xE:
				// RRC (HL) - 16 cycles - Rotate bits of value in memory address found in HL right
				var address = (ths.registers.H << 8) ^ ths.registers.L;
				ths.mmu.write(address, ths.doRrc(ths.mmu.read(address)));
				return 16;
			case 0xF:
				// RRC A - 8 cycles - Rotate bits of register A right
				ths.registers.A = ths.doRrc(ths.registers.A);
				return 8;
			case 0x10:
				// RL B - 8 cycles - Rotate bits of register B left through carry
				ths.registers.B = ths.doRl(ths.registers.B);
				return 8;
			case 0x11:
				// RL C - 8 cycles - Rotate bits of register C left through carry
				ths.registers.C = ths.doRl(ths.registers.C);
				return 8;
			case 0x12:
				// RL D - 8 cycles - Rotate bits of register D left through carry
				ths.registers.D = ths.doRl(ths.registers.D);
				return 8;
			case 0x13:
				// RL E - 8 cycles - Rotate bits of register E left through carry
				ths.registers.E = ths.doRl(ths.registers.E);
				return 8;
			case 0x14:
				// RL H - 8 cycles - Rotate bits of register H left through carry
				ths.registers.H = ths.doRl(ths.registers.H);
				return 8;
			case 0x15:
				// RL L - 8 cycles - Rotate bits of register L left through carry
				ths.registers.L = ths.doRl(ths.registers.L);
				return 8;
			case 0x16:
				// RL (HL) - 16 cycles - Rotate bits of value in memory address found in HL left
				// through carry
				var address = (ths.registers.H << 8) ^ ths.registers.L;
				ths.mmu.write(address, ths.doRl(ths.mmu.read(address)));
				return 16;
			case 0x17:
				// RL A - 8 cycles - Rotate bits of register A left through carry
				ths.registers.A = ths.doRl(ths.registers.A);
				return 8;
			case 0x18:
				// RR B - 8 cycles - Rotate bits of register B right through carry
				ths.registers.B = ths.doRr(ths.registers.B);
				return 8;
			case 0x19:
				// RR C - 8 cycles - Rotate bits of register C right through carry
				ths.registers.C = ths.doRr(ths.registers.C);
				return 8;
			case 0x1A:
				// RR D - 8 cycles - Rotate bits of register D right through carry
				ths.registers.D = ths.doRr(ths.registers.D);
				return 8;
			case 0x1B:
				// RR E - 8 cycles - Rotate bits of register E right through carry
				ths.registers.E = ths.doRr(ths.registers.E);
				return 8;
			case 0x1C:
				// RR H - 8 cycles - Rotate bits of register H right through carry
				ths.registers.H = ths.doRr(ths.registers.H);
				return 8;
			case 0x1D:
				// RR L - 8 cycles - Rotate bits of register L right through carry
				ths.registers.L = ths.doRr(ths.registers.L);
				return 8;
			case 0x1E:
				// RR (HL) - 16 cycles - Rotate bits of value in memory address found in HL right
				// through carry
				var address = (ths.registers.H << 8) ^ ths.registers.L;
				ths.mmu.write(address, ths.doRr(ths.mmu.read(address)));
				return 16;
			case 0x1F:
				// RR A - 8 cycles - Rotate bits of register A right through carry
				ths.registers.A = ths.doRr(ths.registers.A);
				return 8;
			case 0x20:
				// SLA B - 8 cycles - Shift bits of register B left into carry
				ths.registers.B = ths.doSla(ths.registers.B);
				return 8;
			case 0x21:
				// SLA C - 8 cycles - Shift bits of register C left into carry
				ths.registers.C = ths.doSla(ths.registers.C);
				return 8;
			case 0x22:
				// SLA D - 8 cycles - Shift bits of register D left into carry
				ths.registers.D = ths.doSla(ths.registers.D);
				return 8;
			case 0x23:
				// SLA E - 8 cycles - Shift bits of register E left into carry
				ths.registers.E = ths.doSla(ths.registers.E);
				return 8;
			case 0x24:
				// SLA H - 8 cycles - Shift bits of register H left into carry
				ths.registers.H = ths.doSla(ths.registers.H);
				return 8;
			case 0x25:
				// SLA L - 8 cycles - Shift bits of register L left into carry
				ths.registers.L = ths.doSla(ths.registers.L);
				return 8;
			case 0x26:
				// SLA (HL) - 16 cycles - Shift bits of value in memory address found in HL left
				// into carry
				var address = (ths.registers.H << 8) ^ ths.registers.L;
				ths.mmu.write(address, ths.doSla(ths.mmu.read(address)));
				return 16;
			case 0x27:
				// SLA A - 8 cycles - Shift bits of register A left into carry
				ths.registers.A = ths.doSla(ths.registers.A);
				return 8;
			case 0x28:
				// SRA B - 8 cycles - Shift bits of register B right into carry
				ths.registers.B = ths.doSra(ths.registers.B);
				return 8;
			case 0x29:
				// SRA C - 8 cycles - Shift bits of register C right into carry
				ths.registers.C = ths.doSra(ths.registers.C);
				return 8;
			case 0x2A:
				// SRA D - 8 cycles - Shift bits of register D right into carry
				ths.registers.D = ths.doSra(ths.registers.D);
				return 8;
			case 0x2B:
				// SRA E - 8 cycles - Shift bits of register E right into carry
				ths.registers.E = ths.doSra(ths.registers.E);
				return 8;
			case 0x2C:
				// SRA H - 8 cycles - Shift bits of register H right into carry
				ths.registers.H = ths.doSra(ths.registers.H);
				return 8;
			case 0x2D:
				// SRA L - 8 cycles - Shift bits of register L right into carry
				ths.registers.L = ths.doSra(ths.registers.L);
				return 8;
			case 0x2E:
				// SRA (HL) - 16 cycles - Shift bits of value in memory address found in HL right
				// into carry
				var address = (ths.registers.H << 8) ^ ths.registers.L;
				ths.mmu.write(address, ths.doSra(ths.mmu.read(address)));
				return 16;
			case 0x2F:
				// SRA A - 8 cycles - Shift bits of register A right into carry
				ths.registers.A = ths.doSra(ths.registers.A);
				return 8;
			case 0x30:
				// SWAP B - 8 cycles - Swap upper and lower nibbles of register B
				ths.registers.B = ths.doSwap(ths.registers.B);
				return 8;
			case 0x31:
				// SWAP C - 8 cycles - Swap upper and lower nibbles of register C left
				ths.registers.C = ths.doSwap(ths.registers.C);
				return 8;
			case 0x32:
				// SWAP D - 8 cycles - Swap upper and lower nibbles of register D left
				ths.registers.D = ths.doSwap(ths.registers.D);
				return 8;
			case 0x33:
				// SWAP E - 8 cycles - Swap upper and lower nibbles of register E left
				ths.registers.E = ths.doSwap(ths.registers.E);
				return 8;
			case 0x34:
				// SWAP H - 8 cycles - Swap upper and lower nibbles of register H left
				ths.registers.H = ths.doSwap(ths.registers.H);
				return 8;
			case 0x35:
				// SWAP L - 8 cycles - Swap upper and lower nibbles of register L left
				ths.registers.L = ths.doSwap(ths.registers.L);
				return 8;
			case 0x36:
				// SWAP (HL) - 16 cycles - Swap upper and lower nibbles of value in memory
				// address found in HL
				var address = (ths.registers.H << 8) ^ ths.registers.L;
				ths.mmu.write(address, ths.doSwap(ths.mmu.read(address)));
				return 16;
			case 0x37:
				// SWAP A - 8 cycles - Swap upper and lower nibbles of register A left
				ths.registers.A = ths.doSwap(ths.registers.A);
				return 8;
			case 0x38:
				// SRL B - 8 cycles - Shift bits of register B right into carry
				ths.registers.B = ths.doSrl(ths.registers.B);
				return 8;
			case 0x39:
				// SRL C - 8 cycles - Shift bits of register C right into carry
				ths.registers.C = ths.doSrl(ths.registers.C);
				return 8;
			case 0x3A:
				// SRL D - 8 cycles - Shift bits of register D right into carry
				ths.registers.D = ths.doSrl(ths.registers.D);
				return 8;
			case 0x3B:
				// SRL E - 8 cycles - Shift bits of register E right into carry
				ths.registers.E = ths.doSrl(ths.registers.E);
				return 8;
			case 0x3C:
				// SRL H - 8 cycles - Shift bits of register H right into carry
				ths.registers.H = ths.doSrl(ths.registers.H);
				return 8;
			case 0x3D:
				// SRL L - 8 cycles - Shift bits of register L right into carry
				ths.registers.L = ths.doSrl(ths.registers.L);
				return 8;
			case 0x3E:
				// SRL (HL) - 16 cycles - Shift bits of value in memory address found in HL right
				// into carry
				var address = (ths.registers.H << 8) ^ ths.registers.L;
				ths.mmu.write(address, ths.doSrl(ths.mmu.read(address)));
				return 16;
			case 0x3F:
				// SRL A - 8 cycles - Shift bits of register A right into carry
				ths.registers.A = ths.doSrl(ths.registers.A);
				return 8;
			case 0x40:
				// BIT 0, B - 8 cycles - Test bit 0 of register B
				ths.testBit(0, ths.registers.B);
				return 8;
			case 0x41:
				// BIT 0, C - 8 cycles - Test bit 0 of register C
				ths.testBit(0, ths.registers.C);
				return 8;
			case 0x42:
				// BIT 0, D - 8 cycles - Test bit 0 of register D
				ths.testBit(0, ths.registers.D);
				return 8;
			case 0x43:
				// BIT 0, E - 8 cycles - Test bit 0 of register E
				ths.testBit(0, ths.registers.E);
				return 8;
			case 0x44:
				// BIT 0, H - 8 cycles - Test bit 0 of register H
				ths.testBit(0, ths.registers.H);
				return 8;
			case 0x45:
				// BIT 0, L - 8 cycles - Test bit 0 of register L
				ths.testBit(0, ths.registers.L);
				return 8;
			case 0x46:
				// BIT 0, (HL) - 16 cycles - Test bit 0 of data found in memory address in HL
				var address = (ths.registers.H << 8) ^ ths.registers.L;
				ths.testBit(0, ths.mmu.read(address));
				return 16;
			case 0x47:
				// BIT 0, A - 8 cycles - Test bit 0 of register A
				ths.testBit(0, ths.registers.A);
				return 8;
			case 0x48:
				// BIT 1, B - 8 cycles - Test bit 1 of register B
				ths.testBit(1, ths.registers.B);
				return 8;
			case 0x49:
				// BIT 1, C - 8 cycles - Test bit 1 of register C
				ths.testBit(1, ths.registers.C);
				return 8;
			case 0x4A:
				// BIT 1, D - 8 cycles - Test bit 1 of register D
				ths.testBit(1, ths.registers.D);
				return 8;
			case 0x4B:
				// BIT 1, E - 8 cycles - Test bit 1 of register E
				ths.testBit(1, ths.registers.E);
				return 8;
			case 0x4C:
				// BIT 1, H - 8 cycles - Test bit 1 of register H
				ths.testBit(1, ths.registers.H);
				return 8;
			case 0x4D:
				// BIT 1, L - 8 cycles - Test bit 1 of register L
				ths.testBit(1, ths.registers.L);
				return 8;
			case 0x4E:
				// BIT 1, (HL) - 16 cycles - Test bit 1 of data found in memory address in HL
				var address = (ths.registers.H << 8) ^ ths.registers.L;
				ths.testBit(1, ths.mmu.read(address));
				return 16;
			case 0x4F:
				// BIT 1, A - 8 cycles - Test bit 1 of register A
				ths.testBit(1, ths.registers.A);
				return 8;
			case 0x50:
				// BIT 2, B - 8 cycles - Test bit 2 of register B
				ths.testBit(2, ths.registers.B);
				return 8;
			case 0x51:
				// BIT 2, C - 8 cycles - Test bit 2 of register C
				ths.testBit(2, ths.registers.C);
				return 8;
			case 0x52:
				// BIT 2, D - 8 cycles - Test bit 2 of register D
				ths.testBit(2, ths.registers.D);
				return 8;
			case 0x53:
				// BIT 2, E - 8 cycles - Test bit 2 of register E
				ths.testBit(2, ths.registers.E);
				return 8;
			case 0x54:
				// BIT 2, H - 8 cycles - Test bit 2 of register H
				ths.testBit(2, ths.registers.H);
				return 8;
			case 0x55:
				// BIT 2, L - 8 cycles - Test bit 2 of register L
				ths.testBit(2, ths.registers.L);
				return 8;
			case 0x56:
				// BIT 2, (HL) - 16 cycles - Test bit 2 of data found in memory address in HL
				var address = (ths.registers.H << 8) ^ ths.registers.L;
				ths.testBit(2, ths.mmu.read(address));
				return 16;
			case 0x57:
				// BIT 2, A - 8 cycles - Test bit 2 of register A
				ths.testBit(2, ths.registers.A);
				return 8;
			case 0x58:
				// BIT 3, B - 8 cycles - Test bit 3 of register B
				ths.testBit(3, ths.registers.B);
				return 8;
			case 0x59:
				// BIT 3, C - 8 cycles - Test bit 3 of register C
				ths.testBit(3, ths.registers.C);
				return 8;
			case 0x5A:
				// BIT 3, D - 8 cycles - Test bit 3 of register D
				ths.testBit(3, ths.registers.D);
				return 8;
			case 0x5B:
				// BIT 3, E - 8 cycles - Test bit 3 of register E
				ths.testBit(3, ths.registers.E);
				return 8;
			case 0x5C:
				// BIT 3, H - 8 cycles - Test bit 3 of register H
				ths.testBit(3, ths.registers.H);
				return 8;
			case 0x5D:
				// BIT 3, L - 8 cycles - Test bit 3 of register L
				ths.testBit(3, ths.registers.L);
				return 8;
			case 0x5E:
				// BIT 3, (HL) - 16 cycles - Test bit 3 of data found in memory address in HL
				var address = (ths.registers.H << 8) ^ ths.registers.L;
				ths.testBit(3, ths.mmu.read(address));
				return 16;
			case 0x5F:
				// BIT 3, A - 8 cycles - Test bit 3 of register A
				ths.testBit(3, ths.registers.A);
				return 8;
			case 0x60:
				// BIT 4, B - 8 cycles - Test bit 4 of register B
				ths.testBit(4, ths.registers.B);
				return 8;
			case 0x61:
				// BIT 4, C - 8 cycles - Test bit 4 of register C
				ths.testBit(4, ths.registers.C);
				return 8;
			case 0x62:
				// BIT 4, D - 8 cycles - Test bit 4 of register D
				ths.testBit(4, ths.registers.D);
				return 8;
			case 0x63:
				// BIT 4, E - 8 cycles - Test bit 4 of register E
				ths.testBit(4, ths.registers.E);
				return 8;
			case 0x64:
				// BIT 4, H - 8 cycles - Test bit 4 of register H
				ths.testBit(4, ths.registers.H);
				return 8;
			case 0x65:
				// BIT 4, L - 8 cycles - Test bit 4 of register L
				ths.testBit(4, ths.registers.L);
				return 8;
			case 0x66:
				// BIT 4, (HL) - 16 cycles - Test bit 4 of data found in memory address in HL
				var address = (ths.registers.H << 8) ^ ths.registers.L;
				ths.testBit(4, ths.mmu.read(address));
				return 16;
			case 0x67:
				// BIT 4, A - 8 cycles - Test bit 4 of register A
				ths.testBit(4, ths.registers.A);
				return 8;
			case 0x68:
				// BIT 5, B - 8 cycles - Test bit 5 of register B
				ths.testBit(5, ths.registers.B);
				return 8;
			case 0x69:
				// BIT 5, C - 8 cycles - Test bit 5 of register C
				ths.testBit(5, ths.registers.C);
				return 8;
			case 0x6A:
				// BIT 5, D - 8 cycles - Test bit 5 of register D
				ths.testBit(5, ths.registers.D);
				return 8;
			case 0x6B:
				// BIT 5, E - 8 cycles - Test bit 5 of register E
				ths.testBit(5, ths.registers.E);
				return 8;
			case 0x6C:
				// BIT 5, H - 8 cycles - Test bit 5 of register H
				ths.testBit(5, ths.registers.H);
				return 8;
			case 0x6D:
				// BIT 5, L - 8 cycles - Test bit 5 of register L
				ths.testBit(5, ths.registers.L);
				return 8;
			case 0x6E:
				// BIT 5, (HL) - 16 cycles - Test bit 5 of data found in memory address in HL
				var address = (ths.registers.H << 8) ^ ths.registers.L;
				ths.testBit(5, ths.mmu.read(address));
				return 16;
			case 0x6F:
				// BIT 5, A - 8 cycles - Test bit 5 of register A
				ths.testBit(5, ths.registers.A);
				return 8;
			case 0x70:
				// BIT 6, B - 8 cycles - Test bit 6 of register B
				ths.testBit(6, ths.registers.B);
				return 8;
			case 0x71:
				// BIT 6, C - 8 cycles - Test bit 6 of register C
				ths.testBit(6, ths.registers.C);
				return 8;
			case 0x72:
				// BIT 6, D - 8 cycles - Test bit 6 of register D
				ths.testBit(6, ths.registers.D);
				return 8;
			case 0x73:
				// BIT 6, E - 8 cycles - Test bit 6 of register E
				ths.testBit(6, ths.registers.E);
				return 8;
			case 0x74:
				// BIT 6, H - 8 cycles - Test bit 6 of register H
				ths.testBit(6, ths.registers.H);
				return 8;
			case 0x75:
				// BIT 6, L - 8 cycles - Test bit 6 of register L
				ths.testBit(6, ths.registers.L);
				return 8;
			case 0x76:
				// BIT 6, (HL) - 16 cycles - Test bit 6 of data found in memory address in HL
				var address = (ths.registers.H << 8) ^ ths.registers.L;
				ths.testBit(6, ths.mmu.read(address));
				return 16;
			case 0x77:
				// BIT 6, A - 8 cycles - Test bit 6 of register A
				ths.testBit(6, ths.registers.A);
				return 8;
			case 0x78:
				// BIT 7, B - 8 cycles - Test bit 7 of register B
				ths.testBit(7, ths.registers.B);
				return 8;
			case 0x79:
				// BIT 7, C - 8 cycles - Test bit 7 of register C
				ths.testBit(7, ths.registers.C);
				return 8;
			case 0x7A:
				// BIT 7, D - 8 cycles - Test bit 7 of register D
				ths.testBit(7, ths.registers.D);
				return 8;
			case 0x7B:
				// BIT 7, E - 8 cycles - Test bit 7 of register E
				ths.testBit(7, ths.registers.E);
				return 8;
			case 0x7C:
				// BIT 7, H - 8 cycles - Test bit 7 of register H
				ths.testBit(7, ths.registers.H);
				return 8;
			case 0x7D:
				// BIT 7, L - 8 cycles - Test bit 7 of register L
				ths.testBit(7, ths.registers.L);
				return 8;
			case 0x7E:
				// BIT 7, (HL) - 16 cycles - Test bit 7 of data found in memory address in HL
				var address = (ths.registers.H << 8) ^ ths.registers.L;
				ths.testBit(7, ths.mmu.read(address));
				return 16;
			case 0x7F:
				// BIT 7, A - 8 cycles - Test bit 7 of register A
				ths.testBit(7, ths.registers.A);
				return 8;
			case 0x80:
				// RES 0, B - 8 cycles - Reset bit 0 of register B
				ths.registers.B = ths.resetBit(0, ths.registers.B);
				return 8;
			case 0x81:
				// RES 0, C - 8 cycles - Reset bit 0 of register C
				ths.registers.C = ths.resetBit(0, ths.registers.C);
				return 8;
			case 0x82:
				// RES 0, D - 8 cycles - Reset bit 0 of register D
				ths.registers.D = ths.resetBit(0, ths.registers.D);
				return 8;
			case 0x83:
				// RES 0, E - 8 cycles - Reset bit 0 of register E
				ths.registers.E = ths.resetBit(0, ths.registers.E);
				return 8;
			case 0x84:
				// RES 0, H - 8 cycles - Reset bit 0 of register H
				ths.registers.H = ths.resetBit(0, ths.registers.H);
				return 8;
			case 0x85:
				// RES 0, L - 8 cycles - Reset bit 0 of register L
				ths.registers.L = ths.resetBit(0, ths.registers.L);
				return 8;
			case 0x86:
				// RES 0, (HL) - 16 cycles - Reset bit 0 of data found in memory address in HL
				var address = (ths.registers.H << 8) ^ ths.registers.L;
				ths.mmu.write(address, ths.resetBit(0, ths.mmu.read(address)));
				return 16;
			case 0x87:
				// RES 0, A - 8 cycles - Reset bit 0 of register A
				ths.registers.A = ths.resetBit(0, ths.registers.A);
				return 8;
			case 0x88:
				// RES 1, B - 8 cycles - Reset bit 1 of register B
				ths.registers.B = ths.resetBit(1, ths.registers.B);
				return 8;
			case 0x89:
				// RES 1, C - 8 cycles - Reset bit 1 of register C
				ths.registers.C = ths.resetBit(1, ths.registers.C);
				return 8;
			case 0x8A:
				// RES 1, D - 8 cycles - Reset bit 1 of register D
				ths.registers.D = ths.resetBit(1, ths.registers.D);
				return 8;
			case 0x8B:
				// RES 1, E - 8 cycles - Reset bit 1 of register E
				ths.registers.E = ths.resetBit(1, ths.registers.E);
				return 8;
			case 0x8C:
				// RES 1, H - 8 cycles - Reset bit 1 of register H
				ths.registers.H = ths.resetBit(1, ths.registers.H);
				return 8;
			case 0x8D:
				// RES 1, L - 8 cycles - Reset bit 1 of register L
				ths.registers.L = ths.resetBit(1, ths.registers.L);
				return 8;
			case 0x8E:
				// RES 1, (HL) - 16 cycles - Reset bit 1 of data found in memory address in HL
				var address = (ths.registers.H << 8) ^ ths.registers.L;
				ths.mmu.write(address, ths.resetBit(1, ths.mmu.read(address)));
				return 16;
			case 0x8F:
				// RES 1, A - 8 cycles - Reset bit 1 of register A
				ths.registers.A = ths.resetBit(1, ths.registers.A);
				return 8;
			case 0x90:
				// RES 2, B - 8 cycles - Reset bit 2 of register B
				ths.registers.B = ths.resetBit(2, ths.registers.B);
				return 8;
			case 0x91:
				// RES 2, C - 8 cycles - Reset bit 2 of register C
				ths.registers.C = ths.resetBit(2, ths.registers.C);
				return 8;
			case 0x92:
				// RES 2, D - 8 cycles - Reset bit 2 of register D
				ths.registers.D = ths.resetBit(2, ths.registers.D);
				return 8;
			case 0x93:
				// RES 2, E - 8 cycles - Reset bit 2 of register E
				ths.registers.E = ths.resetBit(2, ths.registers.E);
				return 8;
			case 0x94:
				// RES 2, H - 8 cycles - Reset bit 2 of register H
				ths.registers.H = ths.resetBit(2, ths.registers.H);
				return 8;
			case 0x95:
				// RES 2, L - 8 cycles - Reset bit 2 of register L
				ths.registers.L = ths.resetBit(2, ths.registers.L);
				return 8;
			case 0x96:
				// RES 2, (HL) - 16 cycles - Reset bit 2 of data found in memory address in HL
				var address = (ths.registers.H << 8) ^ ths.registers.L;
				ths.mmu.write(address, ths.resetBit(2, ths.mmu.read(address)));
				return 16;
			case 0x97:
				// RES 2, A - 8 cycles - Reset bit 2 of register A
				ths.registers.A = ths.resetBit(2, ths.registers.A);
				return 8;
			case 0x98:
				// RES 3, B - 8 cycles - Reset bit 3 of register B
				ths.registers.B = ths.resetBit(3, ths.registers.B);
				return 8;
			case 0x99:
				// RES 3, C - 8 cycles - Reset bit 3 of register C
				ths.registers.C = ths.resetBit(3, ths.registers.C);
				return 8;
			case 0x9A:
				// RES 3, D - 8 cycles - Reset bit 3 of register D
				ths.registers.D = ths.resetBit(3, ths.registers.D);
				return 8;
			case 0x9B:
				// RES 3, E - 8 cycles - Reset bit 3 of register E
				ths.registers.E = ths.resetBit(3, ths.registers.E);
				return 8;
			case 0x9C:
				// RES 3, H - 8 cycles - Reset bit 3 of register H
				ths.registers.H = ths.resetBit(3, ths.registers.H);
				return 8;
			case 0x9D:
				// RES 3, L - 8 cycles - Reset bit 3 of register L
				ths.registers.L = ths.resetBit(3, ths.registers.L);
				return 8;
			case 0x9E:
				// RES 3, (HL) - 16 cycles - Reset bit 3 of data found in memory address in HL
				var address = (ths.registers.H << 8) ^ ths.registers.L;
				ths.mmu.write(address, ths.resetBit(3, ths.mmu.read(address)));
				return 16;
			case 0x9F:
				// RES 3, A - 8 cycles - Reset bit 3 of register A
				ths.registers.A = ths.resetBit(3, ths.registers.A);
				return 8;
			case 0xA0:
				// RES 4, B - 8 cycles - Reset bit 4 of register B
				ths.registers.B = ths.resetBit(4, ths.registers.B);
				return 8;
			case 0xA1:
				// RES 4, C - 8 cycles - Reset bit 4 of register C
				ths.registers.C = ths.resetBit(4, ths.registers.C);
				return 8;
			case 0xA2:
				// RES 4, D - 8 cycles - Reset bit 4 of register D
				ths.registers.D = ths.resetBit(4, ths.registers.D);
				return 8;
			case 0xA3:
				// RES 4, E - 8 cycles - Reset bit 4 of register E
				ths.registers.E = ths.resetBit(4, ths.registers.E);
				return 8;
			case 0xA4:
				// RES 4, H - 8 cycles - Reset bit 4 of register H
				ths.registers.H = ths.resetBit(4, ths.registers.H);
				return 8;
			case 0xA5:
				// RES 4, L - 8 cycles - Reset bit 4 of register L
				ths.registers.L = ths.resetBit(4, ths.registers.L);
				return 8;
			case 0xA6:
				// RES 4, (HL) - 16 cycles - Reset bit 4 of data found in memory address in HL
				var address = (ths.registers.H << 8) ^ ths.registers.L;
				ths.mmu.write(address, ths.resetBit(4, ths.mmu.read(address)));
				return 16;
			case 0xA7:
				// RES 4, A - 8 cycles - Reset bit 4 of register A
				ths.registers.A = ths.resetBit(4, ths.registers.A);
				return 8;
			case 0xA8:
				// RES 5, B - 8 cycles - Reset bit 5 of register B
				ths.registers.B = ths.resetBit(5, ths.registers.B);
				return 8;
			case 0xA9:
				// RES 5, C - 8 cycles - Reset bit 5 of register C
				ths.registers.C = ths.resetBit(5, ths.registers.C);
				return 8;
			case 0xAA:
				// RES 5, D - 8 cycles - Reset bit 5 of register D
				ths.registers.D = ths.resetBit(5, ths.registers.D);
				return 8;
			case 0xAB:
				// RES 5, E - 8 cycles - Reset bit 5 of register E
				ths.registers.E = ths.resetBit(5, ths.registers.E);
				return 8;
			case 0xAC:
				// RES 5, H - 8 cycles - Reset bit 5 of register H
				ths.registers.H = ths.resetBit(5, ths.registers.H);
				return 8;
			case 0xAD:
				// RES 5, L - 8 cycles - Reset bit 5 of register L
				ths.registers.L = ths.resetBit(5, ths.registers.L);
				return 8;
			case 0xAE:
				// RES 5, (HL) - 16 cycles - Reset bit 5 of data found in memory address in HL
				var address = (ths.registers.H << 8) ^ ths.registers.L;
				ths.mmu.write(address, ths.resetBit(5, ths.mmu.read(address)));
				return 16;
			case 0xAF:
				// RES 5, A - 8 cycles - Reset bit 5 of register A
				ths.registers.A = ths.resetBit(5, ths.registers.A);
				return 8;
			case 0xB0:
				// RES 6, B - 8 cycles - Reset bit 6 of register B
				ths.registers.B = ths.resetBit(6, ths.registers.B);
				return 8;
			case 0xB1:
				// RES 6, C - 8 cycles - Reset bit 6 of register C
				ths.registers.C = ths.resetBit(6, ths.registers.C);
				return 8;
			case 0xB2:
				// RES 6, D - 8 cycles - Reset bit 6 of register D
				ths.registers.D = ths.resetBit(6, ths.registers.D);
				return 8;
			case 0xB3:
				// RES 6, E - 8 cycles - Reset bit 6 of register E
				ths.registers.E = ths.resetBit(6, ths.registers.E);
				return 8;
			case 0xB4:
				// RES 6, H - 8 cycles - Reset bit 6 of register H
				ths.registers.H = ths.resetBit(6, ths.registers.H);
				return 8;
			case 0xB5:
				// RES 6, L - 8 cycles - Reset bit 6 of register L
				ths.registers.L = ths.resetBit(6, ths.registers.L);
				return 8;
			case 0xB6:
				// RES 6, (HL) - 16 cycles - Reset bit 6 of data found in memory address in HL
				var address = (ths.registers.H << 8) ^ ths.registers.L;
				ths.mmu.write(address, ths.resetBit(6, ths.mmu.read(address)));
				return 16;
			case 0xB7:
				// RES 6, A - 8 cycles - Reset bit 6 of register A
				ths.registers.A = ths.resetBit(6, ths.registers.A);
				return 8;
			case 0xB8:
				// RES 7, B - 8 cycles - Reset bit 7 of register B
				ths.registers.B = ths.resetBit(7, ths.registers.B);
				return 8;
			case 0xB9:
				// RES 7, C - 8 cycles - Reset bit 7 of register C
				ths.registers.C = ths.resetBit(7, ths.registers.C);
				return 8;
			case 0xBA:
				// RES 7, D - 8 cycles - Reset bit 7 of register D
				ths.registers.D = ths.resetBit(7, ths.registers.D);
				return 8;
			case 0xBB:
				// RES 7, E - 8 cycles - Reset bit 7 of register E
				ths.registers.E = ths.resetBit(7, ths.registers.E);
				return 8;
			case 0xBC:
				// RES 7, H - 8 cycles - Reset bit 7 of register H
				ths.registers.H = ths.resetBit(7, ths.registers.H);
				return 8;
			case 0xBD:
				// RES 7, L - 8 cycles - Reset bit 7 of register L
				ths.registers.L = ths.resetBit(7, ths.registers.L);
				return 8;
			case 0xBE:
				// RES 7, (HL) - 16 cycles - Reset bit 7 of data found in memory address in HL
				var address = (ths.registers.H << 8) ^ ths.registers.L;
				ths.mmu.write(address, ths.resetBit(7, ths.mmu.read(address)));
				return 16;
			case 0xBF:
				// RES 7, A - 8 cycles - Reset bit 7 of register A
				ths.registers.A = ths.resetBit(7, ths.registers.A);
				return 8;
			case 0xC0:
				// SET 0, B - 8 cycles - Set bit 0 of register B
				ths.registers.B = ths.setBit(0, ths.registers.B);
				return 8;
			case 0xC1:
				// SET 0, C - 8 cycles - Set bit 0 of register C
				ths.registers.C = ths.setBit(0, ths.registers.C);
				return 8;
			case 0xC2:
				// SET 0, D - 8 cycles - Set bit 0 of register D
				ths.registers.D = ths.setBit(0, ths.registers.D);
				return 8;
			case 0xC3:
				// SET 0, E - 8 cycles - Set bit 0 of register E
				ths.registers.E = ths.setBit(0, ths.registers.E);
				return 8;
			case 0xC4:
				// SET 0, H - 8 cycles - Set bit 0 of register H
				ths.registers.H = ths.setBit(0, ths.registers.H);
				return 8;
			case 0xC5:
				// SET 0, L - 8 cycles - Set bit 0 of register L
				ths.registers.L = ths.setBit(0, ths.registers.L);
				return 8;
			case 0xC6:
				// SET 0, (HL) - 16 cycles - Set bit 0 of data found in memory address in HL
				var address = (ths.registers.H << 8) ^ ths.registers.L;
				ths.mmu.write(address, ths.setBit(0, ths.mmu.read(address)));
				return 16;
			case 0xC7:
				// SET 0, A - 8 cycles - Set bit 0 of register A
				ths.registers.A = ths.setBit(0, ths.registers.A);
				return 8;
			case 0xC8:
				// SET 1, B - 8 cycles - Set bit 1 of register B
				ths.registers.B = ths.setBit(1, ths.registers.B);
				return 8;
			case 0xC9:
				// SET 1, C - 8 cycles - Set bit 1 of register C
				ths.registers.C = ths.setBit(1, ths.registers.C);
				return 8;
			case 0xCA:
				// SET 1, D - 8 cycles - Set bit 1 of register D
				ths.registers.D = ths.setBit(1, ths.registers.D);
				return 8;
			case 0xCB:
				// SET 1, E - 8 cycles - Set bit 1 of register E
				ths.registers.E = ths.setBit(1, ths.registers.E);
				return 8;
			case 0xCC:
				// SET 1, H - 8 cycles - Set bit 1 of register H
				ths.registers.H = ths.setBit(1, ths.registers.H);
				return 8;
			case 0xCD:
				// SET 1, L - 8 cycles - Set bit 1 of register L
				ths.registers.L = ths.setBit(1, ths.registers.L);
				return 8;
			case 0xCE:
				// SET 1, (HL) - 16 cycles - Set bit 1 of data found in memory address in HL
				var address = (ths.registers.H << 8) ^ ths.registers.L;
				ths.mmu.write(address, ths.setBit(1, ths.mmu.read(address)));
				return 16;
			case 0xCF:
				// SET 1, A - 8 cycles - Set bit 1 of register A
				ths.registers.A = ths.setBit(1, ths.registers.A);
				return 8;
			case 0xD0:
				// SET 2, B - 8 cycles - Set bit 2 of register B
				ths.registers.B = ths.setBit(2, ths.registers.B);
				return 8;
			case 0xD1:
				// SET 2, C - 8 cycles - Set bit 2 of register C
				ths.registers.C = ths.setBit(2, ths.registers.C);
				return 8;
			case 0xD2:
				// SET 2, D - 8 cycles - Set bit 2 of register D
				ths.registers.D = ths.setBit(2, ths.registers.D);
				return 8;
			case 0xD3:
				// SET 2, E - 8 cycles - Set bit 2 of register E
				ths.registers.E = ths.setBit(2, ths.registers.E);
				return 8;
			case 0xD4:
				// SET 2, H - 8 cycles - Set bit 2 of register H
				ths.registers.H = ths.setBit(2, ths.registers.H);
				return 8;
			case 0xD5:
				// SET 2, L - 8 cycles - Set bit 2 of register L
				ths.registers.L = ths.setBit(2, ths.registers.L);
				return 8;
			case 0xD6:
				// SET 2, (HL) - 16 cycles - Set bit 2 of data found in memory address in HL
				var address = (ths.registers.H << 8) ^ ths.registers.L;
				ths.mmu.write(address, ths.setBit(2, ths.mmu.read(address)));
				return 16;
			case 0xD7:
				// SET 2, A - 8 cycles - Set bit 2 of register A
				ths.registers.A = ths.setBit(2, ths.registers.A);
				return 8;
			case 0xD8:
				// SET 3, B - 8 cycles - Set bit 3 of register B
				ths.registers.B = ths.setBit(3, ths.registers.B);
				return 8;
			case 0xD9:
				// SET 3, C - 8 cycles - Set bit 3 of register C
				ths.registers.C = ths.setBit(3, ths.registers.C);
				return 8;
			case 0xDA:
				// SET 3, D - 8 cycles - Set bit 3 of register D
				ths.registers.D = ths.setBit(3, ths.registers.D);
				return 8;
			case 0xDB:
				// SET 3, E - 8 cycles - Set bit 3 of register E
				ths.registers.E = ths.setBit(3, ths.registers.E);
				return 8;
			case 0xDC:
				// SET 3, H - 8 cycles - Set bit 3 of register H
				ths.registers.H = ths.setBit(3, ths.registers.H);
				return 8;
			case 0xDD:
				// SET 3, L - 8 cycles - Set bit 3 of register L
				ths.registers.L = ths.setBit(3, ths.registers.L);
				return 8;
			case 0xDE:
				// SET 3, (HL) - 16 cycles - Set bit 3 of data found in memory address in HL
				var address = (ths.registers.H << 8) ^ ths.registers.L;
				ths.mmu.write(address, ths.setBit(3, ths.mmu.read(address)));
				return 16;
			case 0xDF:
				// SET 3, A - 8 cycles - Set bit 3 of register A
				ths.registers.A = ths.setBit(3, ths.registers.A);
				return 8;
			case 0xE0:
				// SET 4, B - 8 cycles - Set bit 4 of register B
				ths.registers.B = ths.setBit(4, ths.registers.B);
				return 8;
			case 0xE1:
				// SET 4, C - 8 cycles - Set bit 4 of register C
				ths.registers.C = ths.setBit(4, ths.registers.C);
				return 8;
			case 0xE2:
				// SET 4, D - 8 cycles - Set bit 4 of register D
				ths.registers.D = ths.setBit(4, ths.registers.D);
				return 8;
			case 0xE3:
				// SET 4, E - 8 cycles - Set bit 4 of register E
				ths.registers.E = ths.setBit(4, ths.registers.E);
				return 8;
			case 0xE4:
				// SET 4, H - 8 cycles - Set bit 4 of register H
				ths.registers.H = ths.setBit(4, ths.registers.H);
				return 8;
			case 0xE5:
				// SET 4, L - 8 cycles - Set bit 4 of register L
				ths.registers.L = ths.setBit(4, ths.registers.L);
				return 8;
			case 0xE6:
				// SET 4, (HL) - 16 cycles - Set bit 4 of data found in memory address in HL
				var address = (ths.registers.H << 8) ^ ths.registers.L;
				ths.mmu.write(address, ths.setBit(4, ths.mmu.read(address)));
				return 16;
			case 0xE7:
				// SET 4, A - 8 cycles - Set bit 4 of register A
				ths.registers.A = ths.setBit(4, ths.registers.A);
				return 8;
			case 0xE8:
				// SET 5, B - 8 cycles - Set bit 5 of register B
				ths.registers.B = ths.setBit(5, ths.registers.B);
				return 8;
			case 0xE9:
				// SET 5, C - 8 cycles - Set bit 5 of register C
				ths.registers.C = ths.setBit(5, ths.registers.C);
				return 8;
			case 0xEA:
				// SET 5, D - 8 cycles - Set bit 5 of register D
				ths.registers.D = ths.setBit(5, ths.registers.D);
				return 8;
			case 0xEB:
				// SET 5, E - 8 cycles - Set bit 5 of register E
				ths.registers.E = ths.setBit(5, ths.registers.E);
				return 8;
			case 0xEC:
				// SET 5, H - 8 cycles - Set bit 5 of register H
				ths.registers.H = ths.setBit(5, ths.registers.H);
				return 8;
			case 0xED:
				// SET 5, L - 8 cycles - Set bit 5 of register L
				ths.registers.L = ths.setBit(5, ths.registers.L);
				return 8;
			case 0xEE:
				// SET 5, (HL) - 16 cycles - Set bit 5 of data found in memory address in HL
				var address = (ths.registers.H << 8) ^ ths.registers.L;
				ths.mmu.write(address, ths.setBit(5, ths.mmu.read(address)));
				return 16;
			case 0xEF:
				// SET 5, A - 8 cycles - Set bit 5 of register A
				ths.registers.A = ths.setBit(5, ths.registers.A);
				return 8;
			case 0xF0:
				// SET 6, B - 8 cycles - Set bit 6 of register B
				ths.registers.B = ths.setBit(6, ths.registers.B);
				return 8;
			case 0xF1:
				// SET 6, C - 8 cycles - Set bit 6 of register C
				ths.registers.C = ths.setBit(6, ths.registers.C);
				return 8;
			case 0xF2:
				// SET 6, D - 8 cycles - Set bit 6 of register D
				ths.registers.D = ths.setBit(6, ths.registers.D);
				return 8;
			case 0xF3:
				// SET 6, E - 8 cycles - Set bit 6 of register E
				ths.registers.E = ths.setBit(6, ths.registers.E);
				return 8;
			case 0xF4:
				// SET 6, H - 8 cycles - Set bit 6 of register H
				ths.registers.H = ths.setBit(6, ths.registers.H);
				return 8;
			case 0xF5:
				// SET 6, L - 8 cycles - Set bit 6 of register L
				ths.registers.L = ths.setBit(6, ths.registers.L);
				return 8;
			case 0xF6:
				// SET 6, (HL) - 16 cycles - Set bit 6 of data found in memory address in HL
				var address = (ths.registers.H << 8) ^ ths.registers.L;
				ths.mmu.write(address, ths.setBit(6, ths.mmu.read(address)));
				return 16;
			case 0xF7:
				// SET 6, A - 8 cycles - Set bit 6 of register A
				ths.registers.A = ths.setBit(6, ths.registers.A);
				return 8;
			case 0xF8:
				// SET 7, B - 8 cycles - Set bit 7 of register B
				ths.registers.B = ths.setBit(7, ths.registers.B);
				return 8;
			case 0xF9:
				// SET 7, C - 8 cycles - Set bit 7 of register C
				ths.registers.C = ths.setBit(7, ths.registers.C);
				return 8;
			case 0xFA:
				// SET 7, D - 8 cycles - Set bit 7 of register D
				ths.registers.D = ths.setBit(7, ths.registers.D);
				return 8;
			case 0xFB:
				// SET 7, E - 8 cycles - Set bit 7 of register E
				ths.registers.E = ths.setBit(7, ths.registers.E);
				return 8;
			case 0xFC:
				// SET 7, H - 8 cycles - Set bit 7 of register H
				ths.registers.H = ths.setBit(7, ths.registers.H);
				return 8;
			case 0xFD:
				// SET 7, L - 8 cycles - Set bit 7 of register L
				ths.registers.L = ths.setBit(7, ths.registers.L);
				return 8;
			case 0xFE:
				// SET 7, (HL) - 16 cycles - Set bit 7 of data found in memory address in HL
				var address = (ths.registers.H << 8) ^ ths.registers.L;
				ths.mmu.write(address, ths.setBit(7, ths.mmu.read(address)));
				return 16;
			case 0xFF:
				// SET 7, A - 8 cycles - Set bit 7 of register A
				ths.registers.A = ths.setBit(7, ths.registers.A);
				return 8;
			default:
				return 0;
		}
	};

}
