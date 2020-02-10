# Beat Saber Hue

Sync your Philips Hue lighting to Beat Saber.

## Prerequisites

This program requires NodeJS to be installed on your system

- [NodeJS Download](https://nodejs.org/) (install the LTS release)

### Beat Saber Plugins

-  [HTTP Status](https://github.com/opl-/beatsaber-http-status/releases)


## Usage

1. Copy the `.env.example` file to a new file called `.env`
    1. Renaming the file in Windows Explorer you need to type `.env.`, this will allow you to create a hidden file, the dot at the end will be removed
    2. If you cannot see the `.env.example` file, you may need to enable hidden files in Windows Explorer. [Guide](https://support.microsoft.com/en-gb/help/4028316/windows-view-hidden-files-and-folders-in-windows-10)
2. Populate the variables in your `.env` file as per the comments in the file
3. Launch Beat Saber **BEFORE** launching this script, let the game fully load to the main menu
4. Run `start.bat` in this directory
    1. The first time running this you will get a `link button not pressed` error, simply press the link button on your Hue bridge and run the script again. *You should only need to do this once*
    2. If you want to start using a different bridge after you have already done this, delete the `auth.json` file located in this directory
5. That's it! You should see your lighting change to white and the message `Connected to Beat Saber!`. Go ahead and load your favourite song

## Modes

There are 2 lighting modes available which is defined in your `.env`; `notes` and `lighting`

### Notes

This mode will sync your lighting with the colour of the notes you hit

### Lighting

This mode will sync your lighting with the background lighting in-game

## Optional configuration

You can define custom colours to use instead of the default red and blue. You can also change the lighting colour in-between levels

Define the following variables in your `.env` file, each on a new line

```
# Replaces the red colour. Use a RGB value in the same format as below
COLOR_A=255,0,0

# Replaces the blue colour. Use a RGB value in the same format as below
COLOR_B=0,0,255

# Replaces the purple colour used for KDA's POP/STARS. Use a RGB value in the same format as below
COLOR_KDA=139,9,153

# Replaces the white colour used in menus. Use a RGB value in the same format as below
COLOR_IDLE=255,255,255

# Replaces the black colour used in game when you first start a song. Use a RGB value in the same format as below
COLOR_IDLEDARK=0,0,0
```

## Hue Entertainment Area

When using `lighting` mode, set up your entertainment area using the setups below to provide the best experience. Each zone reacts to different light sources in-game, so the more lights you have, the better it will be!

### 1 Light Setup

If you only have 1 light in your entertainment area, it doesn't matter where you place it in the room, it will always be treated as a center light

### 2-3 Light Setup

If you have 2 or 3 lights in your entertainment area, we split the room up into 3 sections; left, center and right as shown in the below image. Place your lights in the zones you want them to use

![2-3 light setup zones](https://github.com/Jared0430/beatsaber-hue/raw/master/3-lights.png)

### 4+ Light Setup

If you have lots of money and have yourself 4+ lights in your entertainment group, we split the room up into 6 sections as shown below. This is the ultimate lighting setup

![4+ light setup zones](https://github.com/Jared0430/beatsaber-hue/raw/master/more-lights.png)
