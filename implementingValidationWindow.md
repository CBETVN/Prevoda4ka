## Plan: Implement Validate Document Window

### 1. Data Source
- Use the validation logic from  
	[src/api/validateMasterFile.js](src/api/validateMasterFile.js)  
	(specifically, the `validateDoc` function) to gather validation results.

### 2. UI Trigger
- The window should open when the user clicks the `ValidateMFButton` component.

### 3. Window Design
- The window should be a popup overlay - you have to close it to continue working.
- Content:
	- Display validation results as text (e.g., missing fonts, nested SOs), fuzzyness of the naming of layers, folders etc.
	- Nice to have a "Success predictment" bar that goes from red to green
	- Only one action button: **Close** (closes the window).



#### d. Display Results
- In `ValidationWindow`, render:
	- Text summary of validation (e.g., "No missing fonts", "2 nested Smart Objects found").
	- A single **Close** button that calls `onClose`.

#### e. Styling
- Style the window as a modal overlay (centered, with backdrop).
- Use CSS for layout and graphics.

### 5. Testing
- Test with documents that have:
	- No issues .
	- Missing fonts.
	- Nested Smart Objects.
- Ensure the window displays correct info and closes as expected.
