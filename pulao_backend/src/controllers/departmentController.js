import Department from '../models/Department.js';
import DepartmentArea from '../models/DepartmentArea.js';

export const getDepartments = async (req, res) => {
  try {
    const departments = await Department.find();
    res.json(departments);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const getDepartmentAreas = async (req, res) => {
  try {
    const departmentAreas = await DepartmentArea.find();
    res.json(departmentAreas);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
