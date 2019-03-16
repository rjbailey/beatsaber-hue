# Beat Saber Hue

Sync your Philips Hue lighting to Beat Saber.

## Prerequisites

This program requires NodeJS to be installed on your system

- [NodeJS Download](https://nodejs.org/) (install the LTS release)

### Beat Saber Plugins

-  [HTTP Status](https://www.modsaber.org/mod/http-status)


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

# Replaces the white colour used in menus. Use a RGB value in the same format as below
COLOR_IDLE=255,255,255

# Replaces the black colour used in game when you first start a song. Use a RGB value in the same format as below
COLOR_IDLEDARK=0,0,0
```
