function MMU() {
	// MEMORY INFO
	//
	// 0000-3FFF 16KB ROM Bank 00 (in cartridge, fixed at bank 00)
	// 4000-7FFF 16KB ROM Bank 01..NN (in cartridge, switchable bank number)
	// 8000-9FFF 8KB Video RAM (VRAM) (switchable bank 0-1 in CGB Mode)
	// A000-BFFF 8KB External RAM (in cartridge, switchable bank, if any)
	// C000-CFFF 4KB Work RAM Bank 0 (WRAM)
	// D000-DFFF 4KB Work RAM Bank 1 (WRAM) (switchable bank 1-7 in CGB Mode)
	// E000-FDFF Same as C000-DDFF (ECHO) (typically not used)
	// FE00-FE9F Sprite Attribute Table (OAM)
	// FEA0-FEFF Not Usable
	// FF00-FF7F I/O Ports
	// FF80-FFFE High RAM (HRAM)
	// FFFF Interrupt Enable Register

	var ths = this;

	this.memory = new Array(0x10000);
	this.cartridgeData = null;

	// Joypad byte - we will use 8 bits for denoting key pressed - not the same
	// as internal memory joypad state. Just for convenience sake and for setting
	// internal memory
	this.JOYPAD = new Array(8);

	// There are two types of rom banking, MBC1 and MBC2
	// Some games don't use either and the rom bank mode is found at memory
	// location 0x147 after the game is loaded into memory (0x000 - 0x7FFF)
	// Use flags to determine which type of rom banking is being used
	this.mbc1 = false;
	this.mbc2 = false;
	this.romBanking = true;

	// Different rom banks could be loaded into second area of memory (4000 - 7FFF)
	// But memory region 0000 - 7FFF is fixed at rom bank 0. That stays loaded
	// So keep a variable that says what rom bank is loaded into the second region
	// Init to 1 as that's the first bank that loads (should never be 0)
	this.currentRomBank = 1;

	// Memory location 0x148 tells how many RAM banks exist
	// A RAM bank is 0x2000 bytes in size and the maximum RAM banks that a game can
	// have is 4. Keep an Array variable to represent 4 RAM banks (0x8000 in size)
	// and a variable to tell us which RAM bank is being used currently (between 0 and 3)
	// RAM banking isn't used if ROM bank mode is MBC2 so currentRamBank will stay 0
	this.ramBanks = new Array(0x8000);
	this.currentRamBank = 0;
	this.enableRam = false;

	this.initialize = function() {
		// Init Memory to all 0 and then some spots equal to the following (from Docs)
		for (var i = 0; i < ths.memory.length; i++) {
			ths.memory[i] = 0;
		}

		ths.memory[0xFF00] = 0xFF;
		ths.memory[0xFF05] = 0x00;
		ths.memory[0xFF06] = 0x00;
		ths.memory[0xFF07] = 0x00;
		ths.memory[0xFF10] = 0x80;
		ths.memory[0xFF11] = 0xBF;
		ths.memory[0xFF12] = 0xF3;
		ths.memory[0xFF14] = 0xBF;
		ths.memory[0xFF16] = 0x3F;
		ths.memory[0xFF17] = 0x00;
		ths.memory[0xFF19] = 0xBF;
		ths.memory[0xFF1A] = 0x7F;
		ths.memory[0xFF1B] = 0xFF;
		ths.memory[0xFF1C] = 0x9F;
		ths.memory[0xFF1E] = 0xBF;
		ths.memory[0xFF20] = 0xFF;
		ths.memory[0xFF21] = 0x00;
		ths.memory[0xFF22] = 0x00;
		ths.memory[0xFF23] = 0xBF;
		ths.memory[0xFF24] = 0x77;
		ths.memory[0xFF25] = 0xF3;
		ths.memory[0xFF26] = 0xF1;
		ths.memory[0xFF40] = 0x91;
		ths.memory[0xFF42] = 0x00;
		ths.memory[0xFF43] = 0x00;
		ths.memory[0xFF45] = 0x00;
		ths.memory[0xFF47] = 0xFC;
		ths.memory[0xFF48] = 0xFF;
		ths.memory[0xFF49] = 0xFF;
		ths.memory[0xFF4A] = 0x00;
		ths.memory[0xFF4B] = 0x00;
		ths.memory[0xFFFF] = 0x00;

		// Initialize Joypad all to 1 (which is unpressed)
		for (var i = 0; i < 8; i++) {
			ths.JOYPAD[i] = 1;
		}
	};

	this.setCartridgeData = function(data) {
		ths.cartridgeData = data;
		// We need to load first bank into Memory 0x000 - 0x7FFF
		for (var i = 0; i < 0x8000; i++) {
			ths.memory[i] = ths.cartridgeData[i];
		}
	}

	this.determineRomBankingType = function() {
		switch (ths.memory[0x147]) {
			case 1:
				ths.mbc1 = true;
				break;
			case 2:
				ths.mbc1 = true;
				break;
			case 3:
				ths.mbc1 = true;
				break;
			case 5:
				ths.mbc2 = true;
				break;
			case 6:
				ths.mbc2 = true;
				break;
			default:
				break;
		}
	};

	this.write = function(address, data) {
		if (address === 0x8000) {
			console.trace();
			// return;
		}
		if (address < 0x8000) {
			// If address is in Game ROM Area, don't write, this is read-only
			// Handle ROM banking though
			ths.handleBanking(address, data);

		} else if (address >= 0xA000 && address < 0xC000) {
     		if (ths.enableRam) {
		       var resolvedAddress = address - 0xA000;
		       ths.ramBanks[resolvedAddress + (ths.currentRamBank * 0x2000)] = data;
     		}

		} else if (address === 0xFF04) {
			// This is the divider register and if we try and write to this,
			// it should reset to 0
			ths.memory[address] = 0;

		} else if (address === 0xFF44) {
			// This is the register that holds the current scanline and if we try
			// to write to this, it should reset to 0
			ths.memory[address] = 0;

		} else if (address === 0xFF46) {
			// When requesting this address, a Direct Memory Access is launched
			// which is when data is copied to Sprite RAM (FE00-FE9F). This can
			// be accessed during LCD Status Mode 2
			ths.doDmaTransfer(data);

		} else if (address >= 0xFEA0 && address < 0xFEFF) {
			// This is not usable memory. Restricted access. Don't write
			return;

		} else if (address >= 0xE000 && address <= 0xFDFF) {
			// If you write to ECHO, you also have to write to RAM
     		ths.write(address - 0x2000, data);
			ths.memory[address] = data;

		} else {
			ths.memory[address] = data;
		}

	};

	this.read = function(address) {

		// If reading the Joypad memory byte, resolve our JOYPAD object to what the
		// memory should actually look lik
		if (address === 0xFF00) {
   			return ths.getJoypadState();
		}

		// If reading from ROM bank, find actual data we want in cartridge memory
		if (address >= 0x4000 && address <= 0x7FFF) {
			var resolvedAddress = address - 0x4000;
			return ths.cartridgeData[resolvedAddress + (ths.currentRomBank * 0x4000)];
		}

		// If reading from RAM bank
		if (address >= 0xA000 && address <= 0xBFFF) {
			var resolvedAddress = address - 0xA000 ;
     		return ths.ramBanks[resolvedAddress + (ths.currentRamBank * 0x2000)] ;
		}

		return ths.memory[address];
	};

	this.handleBanking = function(address, data) {
		if (address < 0x2000) {
			// If the address is between 0x0000 and 0x2000, and ROM Banking is enabled
			// then we attempt RAM enabling
			if (ths.mbc1 || ths.mbc2) {
				ths.doEnableRamBanking(address, data);
			}
		} else if (address >= 0x2000 && address < 0x4000) {
			// If the address is between 0x2000 and 0x4000, and ROM banking is enabled
			// then we perform a ROM bank change
			if (ths.mbc1 || ths.mbc2) {
				ths.doRomLoBankChange(data);
			}
		} else if (address >= 0x4000 && address < 0x6000) {
			// If the address is between 0x4000 and 0x6000 then we perform either
			// a RAM bank change or ROM bank change depending on what RAM/ROM mode
			// is selected
			if (ths.mbc1) {
				// no RAM banking if mbc2
				if (ths.romBanking) {
					ths.doRomHiBankChange(data);
				} else {
					ths.doRamBankChange(data);
				}
			}
		} else if (address >= 0x6000 && address < 0x8000) {
			// In mbc1, rom banking is flipped depending on data to signify
			// a RAM banking change instead. If we are writing to an address
			// between 0x6000 and 0x8000 that is how we know if we should change
			// this flag or not
			if (ths.mbc1) {
				ths.doChangeRomRamMode(data);
			}
		}
	};

	this.doEnableRamBanking = function(address, data) {
		// mbc2 says that bit 4 of the address must be 0 for RAM Banking to be enabled
		if (ths.mbc2) {
			if (address & parseInt('1000', 2)) {
				return; // Bit-Wise AND showed us bit 4 was 1 and not 0 so return
			}

			// If lower nibble of data being written is 0xA then we enable RAM Banking
			// and if the lower nibble is 0 then it is disabled
			var lowerNibble = data & 0xF;
			if (lowerNibble === 0xA) {
				ths.enableRam = true;
			} else if (lowerNibble === 0) {
				ths.enableRam = false;
			}
		}
	};

	this.doRomLoBankChange = function(data) {
		// if mbc1, bits 0-4 are changed but not 5 and 6
		// if mbc2, bits 0-3 are changed and bits 5 and 6 are never set
		if (ths.mbc2) {
			ths.currentRomBank = data & 0xF; // Lower nibble (bits 0-3)
			if (ths.currentRomBank === 0) {
				// This cannot be 0 as rom bank 0 is always in Memory 0000-3FFF
				ths.currentRomBank++;
			}
			return;
		}

		var lowerFiveBits = data & parseInt('11111', 2);
		ths.currentRomBank &= parseInt('11100000', 2); // Flip off the lower 5 bits for now
		ths.currentRomBank |= lowerFiveBits; // Bit wise OR will give us new value for lower 5
		if (ths.currentRomBank === 0) {
			// This cannot be 0 as rom bank 0 is always in Memory 0000-3FFF
			ths.currentRomBank++;
		}
	};

	this.doRomHiBankChange = function(data) {
		// Only used for mbc1, mbc2 doesn't concern itself with the upper bits
		// of the current ROM bank

		ths.currentRomBank &= parseInt('00011111', 2); // Flip off the upper 3 bits for now
		var newData = data & parseInt('11100000', 2) // Flip off the lower 5 bits of data
		ths.currentRomBank |= newData; // Bit wise OR here should give us the bits we care about
		if (ths.currentRomBank === 0) {
			// This cannot be 0 as rom bank 0 is always in Memory 0000-3FFF
			ths.currentRomBank++;
		}
	};

	this.doRamBankChange = function(data) {
		// Only used for mbc1 as mbc2 holds External RAM on the cartridge not in memory
		// Set RAM Bank to the lower 2 bits of the data
		ths.currentRamBank = data & 0x2;
	};

	this.doChangeRomRamMode = function(data) {
		// If least significant bit of data being written is 0 then romBanking is set to true
		// otherwise it is set to false, signifying RAM banking
		// Current RAM bank should be set to 0 if romBanking is true
		var leastSignificantBit = data & 0x1;
		if (leastSignificantBit === 0) {
			ths.romBanking = true;
			ths.currentRamBank = 0;
		} else if (leastSignificantBit === 1) {
			ths.romBanking = false;
		}
	};

	this.doDmaTransfer = function(data) {
		// DMA writes data to the Sprite Attribute Table (OAM), addresses FE00-FE9F
		// The source address of data to be written represented by the data passed in here
		// However, this value is actually the source address divided by 100. We need to
		// multiply it by 100 (to save speed, I have seen the suggestion to bit-wise shift left
		// by 8 spots instead. This is the same as multiplying by 100)

		var sourceAddress = data << 8;
		for (var i = 0xFE00; i <= 0xFE9F; i++) {
			ths.write(i, ths.read(sourceAddress));
			sourceAddress++;
		}
	};

	this.getJoypadState = function() {
		// Our Joypad object represents this
		// Right = 0
		// Left = 1
		// Up = 2
		// Down = 3
		// A = 4
		// B = 5
		// SELECT = 6
		// START = 7

		// Actual byte is this:
		// Bit 7 - Not used
		// Bit 6 - Not used
		// Bit 5 - P15 Select Button Keys (0=Select)
		// Bit 4 - P14 Select Direction Keys (0=Select)
		// Bit 3 - P13 Input Down or Start (0=Pressed) (Read Only)
		// Bit 2 - P12 Input Up or Select (0=Pressed) (Read Only)
		// Bit 1 - P11 Input Left or Button B (0=Pressed) (Read Only)
		// Bit 0 - P10 Input Right or Button A (0=Pressed) (Read Only)

		var result = ths.memory[0xFF00];

		// Flip the bits
		result ^= 0xFF;

		// If we are interested in the standard buttons
		if (result & parseInt("00100000", 2)) {
			// Move the top nibble of the byte that has the standard buttons into
			// a lower nibble
			var topNibble = ths.JOYPAD >> 4;
			topNibble |= 0xF0;
			result &= topNibble;

		} else if (result & parseInt("00010000", 2)) {
			// Directional buttons
			var bottomNibble = ths.JOYPAD & 0xF;
			bottomNibble |= 0xF0;
			result &= bottomNibble;
		}

		return result;
	};

}
